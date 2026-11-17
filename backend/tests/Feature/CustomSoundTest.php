<?php

namespace Tests\Feature;

use App\Models\CustomSound;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/** Uploaded sounds for notification tones and the ringtone: private, limited, and cleaned up on delete. */
class CustomSoundTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake(config('filesystems.attachments_disk'));
    }

    private function upload(User $user, UploadedFile $file, ?string $name = null)
    {
        return $this->actingAs($user)->post('/api/sounds', array_filter(['file' => $file, 'name' => $name]), ['Accept' => 'application/json']);
    }

    public function test_upload_list_play_and_use_as_tone(): void
    {
        $user = User::factory()->create();
        $res = $this->upload($user, UploadedFile::fake()->create('Office bell.mp3', 120, 'audio/mpeg'))
            ->assertCreated()->assertJsonPath('sound.name', 'Office bell')->assertJsonPath('sound.mime_type', 'audio/mpeg');
        $id = $res->json('sound.id');
        $sound = CustomSound::query()->findOrFail($id);
        Storage::disk(config('filesystems.attachments_disk'))->assertExists($sound->path);
        $this->assertSame("sounds/{$user->id}/{$id}.mp3", $sound->path);

        $this->actingAs($user)->getJson('/api/sounds')->assertOk()->assertJsonPath('sounds.0.id', $id);
        $this->actingAs($user)->get("/api/sounds/{$id}/file")->assertOk()
            ->assertHeader('Content-Type', 'audio/mpeg')->assertHeader('X-Content-Type-Options', 'nosniff');

        $tones = ['dm' => "custom:{$id}", 'call' => "custom:{$id}", 'mention' => 'alert'];
        $this->actingAs($user)->patchJson('/api/me', ['notification_tones' => $tones])->assertOk()->assertJsonPath('notification_tones', $tones);
        $this->actingAs($user)->patchJson('/api/me', ['notification_tones' => ['call' => 'trill']])->assertOk();
    }

    public function test_only_audio_files_up_to_the_size_and_count_limits(): void
    {
        $user = User::factory()->create();
        $this->upload($user, UploadedFile::fake()->create('notes.pdf', 10, 'application/pdf'))->assertStatus(422);
        // Named like audio but really a web page.
        // (a real file: fake uploads report whatever type they are given, so the content check needs one)
        $html = tempnam(sys_get_temp_dir(), 'snd');
        file_put_contents($html, '<!doctype html><html><body><script>alert(1)</script></body></html>');
        $this->upload($user, new UploadedFile($html, 'fake.mp3', 'audio/mpeg', null, true))->assertStatus(422);
        $this->upload($user, UploadedFile::fake()->create('song.exe', 10, 'audio/mpeg'))->assertStatus(422);
        $this->upload($user, UploadedFile::fake()->create('big.mp3', CustomSound::MAX_KB + 1, 'audio/mpeg'))->assertStatus(422);

        for ($i = 0; $i < CustomSound::MAX_PER_USER; $i++) {
            $this->upload($user, UploadedFile::fake()->create("s{$i}.wav", 5, 'audio/wav'))->assertCreated();
        }
        $this->upload($user, UploadedFile::fake()->create('one-more.ogg', 5, 'audio/ogg'))->assertStatus(422);
    }

    public function test_sounds_are_private_to_their_owner(): void
    {
        $owner = User::factory()->create();
        $other = User::factory()->admin()->create();
        $id = $this->upload($owner, UploadedFile::fake()->create('mine.m4a', 20, 'audio/x-m4a'))->json('sound.id');

        $this->actingAs($other)->getJson('/api/sounds')->assertOk()->assertJsonCount(0, 'sounds');
        $this->actingAs($other)->get("/api/sounds/{$id}/file")->assertNotFound();
        $this->actingAs($other)->deleteJson("/api/sounds/{$id}")->assertNotFound();
        // ...and cannot point their own tones at it.
        $this->actingAs($other)->patchJson('/api/me', ['notification_tones' => ['dm' => "custom:{$id}"]])->assertStatus(422);
        $this->actingAs($other)->patchJson('/api/me', ['notification_tones' => ['dm' => 'custom:not-a-uuid']])->assertStatus(422);
        $this->assertDatabaseHas('custom_sounds', ['id' => $id]);
    }

    public function test_deleting_a_sound_removes_the_file_and_resets_tones_that_used_it(): void
    {
        $user = User::factory()->create();
        $id = $this->upload($user, UploadedFile::fake()->create('ring.ogg', 20, 'audio/ogg'))->json('sound.id');
        $path = CustomSound::query()->findOrFail($id)->path;
        $user->forceFill(['notification_tones' => ['dm' => "custom:{$id}", 'call' => "custom:{$id}", 'mention' => 'pop']])->save();

        $this->actingAs($user)->deleteJson("/api/sounds/{$id}")->assertOk()->assertJsonPath('notification_tones', ['mention' => 'pop']);
        Storage::disk(config('filesystems.attachments_disk'))->assertMissing($path);
        $this->assertDatabaseMissing('custom_sounds', ['id' => $id]);
        $this->assertSame(['mention' => 'pop'], $user->fresh()->notification_tones);
    }
}
