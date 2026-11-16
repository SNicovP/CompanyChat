<?php

namespace Tests\Feature;

use App\Jobs\SendMessagePush;
use App\Models\Channel;
use App\Models\DeviceToken;
use App\Models\Message;
use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/** Native (Android) push: token registration and the FCM leg of SendMessagePush. */
class DeviceTokenTest extends TestCase
{
    public function test_tokens_move_between_users_and_can_be_changed_and_removed(): void
    {
        $a = User::factory()->create();
        $b = User::factory()->create();

        $this->postJson('/api/device-tokens', ['token' => 't1'])->assertUnauthorized();
        $this->actingAs($a)->postJson('/api/device-tokens', ['token' => 't1'])->assertOk();
        $this->actingAs($b)->postJson('/api/device-tokens', ['token' => 't1', 'show_preview' => false])->assertOk();
        $this->assertDatabaseCount('device_tokens', 1);
        $this->assertDatabaseHas('device_tokens', ['user_id' => $b->id, 'show_preview' => false]);

        $this->actingAs($a)->deleteJson('/api/device-tokens', ['token' => 't1'])->assertOk();
        $this->assertDatabaseCount('device_tokens', 1); // not a's to remove
        $this->actingAs($b)->patchJson('/api/device-tokens', ['token' => 't1', 'show_preview' => true])->assertOk();
        $this->actingAs($b)->deleteJson('/api/device-tokens', ['token' => 't1'])->assertOk();
        $this->assertDatabaseCount('device_tokens', 0);
    }

    public function test_new_dm_message_is_sent_through_fcm_and_dead_tokens_are_forgotten(): void
    {
        $path = tempnam(sys_get_temp_dir(), 'fcm');
        file_put_contents($path, json_encode(['project_id' => 'demo', 'client_email' => 'x@demo.iam.gserviceaccount.com', 'private_key' => 'unused']));
        config(['services.fcm.credentials' => $path]);
        Cache::put('fcm:access-token', 'tok', 60);

        $sender = User::factory()->create();
        $reader = User::factory()->create();
        $dm = Channel::factory()->dm()->create();
        $dm->members()->attach([$sender->id, $reader->id]);
        $message = Message::factory()->for($dm)->for($sender)->create(['body' => 'hello']);
        DeviceToken::create(['user_id' => $reader->id, 'token' => 'good', 'token_hash' => DeviceToken::hash('good')]);
        DeviceToken::create(['user_id' => $reader->id, 'token' => 'dead', 'token_hash' => DeviceToken::hash('dead'), 'show_preview' => false]);
        DeviceToken::create(['user_id' => $sender->id, 'token' => 'mine', 'token_hash' => DeviceToken::hash('mine')]);

        Http::fake(fn ($request) => $request['message']['token'] === 'dead'
            ? Http::response(['error' => ['status' => 'UNREGISTERED']], 404)
            : Http::response(['name' => 'ok']));

        (new SendMessagePush($message->id))->handle();

        Http::assertSentCount(2); // never to the author
        Http::assertSent(fn ($r) => $r['message']['token'] === 'good'
            && $r['message']['notification']['body'] === 'hello'
            && $r['message']['data']['url'] === "/c/{$dm->id}");
        Http::assertSent(fn ($r) => $r['message']['token'] === 'dead' && $r['message']['notification']['body'] === 'New message');
        $this->assertDatabaseMissing('device_tokens', ['token' => 'dead']);
        $this->assertDatabaseHas('device_tokens', ['token' => 'good']);
        unlink($path);
    }
}
