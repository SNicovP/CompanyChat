<?php

namespace Tests\Feature;

use App\Models\Message;
use App\Support\PushMessage;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/** Voice notes, camera photos/videos (ordinary attachments, played inline) and shared locations/contacts. */
class MediaAndShareTest extends TestCase
{
    public function test_share_a_location(): void
    {
        ['member' => $member, 'public' => $public] = $this->office();

        $res = $this->actingAs($member)->postJson("/api/channels/{$public->id}/messages", [
            'share' => ['type' => 'location', 'lat' => -33.9248685, 'lng' => 18.4240553, 'label' => ' Client office ', 'name' => 'ignored'],
        ])->assertCreated();

        $this->assertSame(['type' => 'location', 'lat' => -33.924869, 'lng' => 18.424055, 'label' => 'Client office'], $res->json('share'));
        $this->assertSame('', $res->json('body'));
        $this->actingAs($member)->getJson("/api/channels/{$public->id}/messages")->assertJsonPath('0.share.type', 'location');
    }

    public function test_share_a_contact_and_quote_it(): void
    {
        ['member' => $member, 'admin' => $admin, 'public' => $public] = $this->office();

        $res = $this->actingAs($member)->postJson("/api/channels/{$public->id}/messages", [
            'share' => ['type' => 'contact', 'name' => 'Pat Jones', 'phone' => '+27 82 123 4567', 'email' => 'pat@example.com', 'user_id' => $admin->id],
        ])->assertCreated();
        $this->assertSame('Pat Jones', $res->json('share.name'));
        $this->assertSame($admin->id, $res->json('share.user_id'));

        $reply = $this->actingAs($member)->postJson("/api/channels/{$public->id}/messages", ['body' => 'call them', 'reply_to' => $res->json('id')]);
        $this->assertSame('👤 Pat Jones', $reply->json('reply_preview.summary') ?? $this->actingAs($member)->getJson("/api/channels/{$public->id}/messages")->json('1.reply_preview.summary'));
    }

    public function test_share_rules(): void
    {
        ['member' => $member, 'public' => $public] = $this->office();
        $post = fn (array $share) => $this->actingAs($member)->postJson("/api/channels/{$public->id}/messages", ['share' => $share]);

        $post(['type' => 'location', 'lat' => 91, 'lng' => 0])->assertStatus(422);
        $post(['type' => 'location', 'lat' => 1])->assertStatus(422);
        $post(['type' => 'contact', 'phone' => '123'])->assertStatus(422); // no name
        $post(['type' => 'contact', 'name' => 'X', 'phone' => '<script>'])->assertStatus(422);
        $post(['type' => 'contact', 'name' => 'X', 'user_id' => '3f0c9d4e-8a77-4f5a-9d0a-0d9d6a1b2c3d'])->assertStatus(422);
        $post(['type' => 'poll'])->assertStatus(422);
        $this->assertDatabaseCount('messages', 0);
    }

    public function test_a_share_message_can_have_its_caption_emptied(): void
    {
        ['member' => $member, 'public' => $public] = $this->office();
        $id = $this->actingAs($member)->postJson("/api/channels/{$public->id}/messages", [
            'body' => 'here', 'share' => ['type' => 'location', 'lat' => 1, 'lng' => 2],
        ])->json('id');

        $this->actingAs($member)->patchJson("/api/messages/{$id}", ['body' => ''])->assertOk();
        $this->assertSame('', Message::find($id)->body);
    }

    public function test_voice_notes_and_videos_play_inline_with_range_requests(): void
    {
        Storage::fake('attachments');
        ['member' => $member, 'public' => $public] = $this->office();

        $res = $this->actingAs($member)->post("/api/channels/{$public->id}/messages", [
            'files' => [
                $this->upload('voice-note-1.webm', 'audio/webm', 2048),
                $this->upload('clip.mp4', 'video/mp4', 12 * 1024 * 1024), // over the 10 MB file limit, under the media one
            ],
        ], ['Accept' => 'application/json']);
        $res->assertCreated();
        $ids = array_column($res->json('message_attachments'), 'id');

        $urls = $this->actingAs($member)->postJson('/api/attachments/urls', ['ids' => $ids])->json('urls');
        $this->app['auth']->forgetGuards();
        $audio = $this->get($urls[$ids[0]]);
        $audio->assertOk()->assertHeader('Content-Type', 'audio/webm');
        $this->assertStringStartsWith('inline', $audio->headers->get('Content-Disposition'));

        $part = $this->get($urls[$ids[0]], ['Range' => 'bytes=0-99']);
        $part->assertStatus(206);
        $this->assertSame('bytes 0-99/2048', $part->headers->get('Content-Range'));

        $this->assertStringStartsWith('inline', $this->get($urls[$ids[1]])->headers->get('Content-Disposition'));
    }

    public function test_media_size_limits(): void
    {
        Storage::fake('attachments');
        ['member' => $member, 'public' => $public] = $this->office();
        $post = fn ($file) => $this->actingAs($member)->post("/api/channels/{$public->id}/messages", ['files' => [$file]], ['Accept' => 'application/json']);

        $post(UploadedFile::fake()->create('big.pdf', 11 * 1024, 'application/pdf'))->assertStatus(422);
        $post($this->upload('huge.mp4', 'video/mp4', 51 * 1024 * 1024))->assertStatus(422);
        $this->assertDatabaseCount('messages', 0);
    }

    /** A file as a browser sends it: with the type the browser reported. */
    private function upload(string $name, string $mime, int $bytes): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'up');
        $h = fopen($path, 'w');
        ftruncate($h, $bytes);
        fclose($h);

        return new UploadedFile($path, $name, $mime, null, true);
    }

    public function test_push_text_says_what_a_textless_message_carries(): void
    {
        $nameOf = fn () => 'X';
        $this->assertSame('Pat: 🎤 Voice note', PushMessage::build('watch', 'c', 'project', 'web', 'Pat', '', true, $nameOf, '🎤 Voice note')['body']);
        $this->assertSame('📍 Location', PushMessage::build('dm', 'c', 'dm', null, 'Pat', '', true, $nameOf, '📍 Location')['body']);
    }
}
