<?php

namespace Tests\Feature;

use App\Models\Message;
use Tests\TestCase;

/** Ported from tests/replies.test.ts (the Supabase version). */
class ReplyTest extends TestCase
{
    public function test_reply_to_a_message_in_the_same_channel(): void
    {
        ['member' => $member, 'admin' => $admin, 'public' => $public] = $this->office();
        $original = Message::factory()->create(['channel_id' => $public->id, 'user_id' => $admin->id, 'body' => 'hello']);

        $this->actingAs($member)->postJson("/api/channels/{$public->id}/messages", ['body' => 'hi back', 'reply_to' => $original->id])
            ->assertCreated()->assertJsonPath('reply_to', $original->id);
        $listed = collect($this->actingAs($member)->getJson("/api/channels/{$public->id}/messages")->json())->firstWhere('body', 'hi back');
        $this->assertSame($original->id, $listed['reply_to']);
        $this->assertSame(['user_id' => $admin->id, 'body' => 'hello', 'has_files' => false], $listed['reply_preview']);
    }

    public function test_a_reply_cannot_quote_another_channel(): void
    {
        ['member' => $member, 'admin' => $admin, 'client' => $client, 'public' => $public, 'private' => $private] = $this->office();
        $secret = Message::factory()->create(['channel_id' => $private->id, 'user_id' => $admin->id, 'body' => 'secret']);

        $this->actingAs($member)->postJson("/api/channels/{$public->id}/messages", ['body' => 'sneaky', 'reply_to' => $secret->id])
            ->assertStatus(422)->assertJsonValidationErrors('reply_to');
        $this->assertDatabaseMissing('messages', ['body' => 'sneaky']);
    }

    public function test_replying_to_a_missing_message_is_rejected(): void
    {
        ['member' => $member, 'public' => $public] = $this->office();

        $this->actingAs($member)->postJson("/api/channels/{$public->id}/messages", ['body' => 'hi', 'reply_to' => '3f0c9d4e-8a77-4f5a-9d0a-0d9d6a1b2c3d'])
            ->assertStatus(422);
    }

    public function test_deleting_the_original_keeps_the_reply_without_its_quote(): void
    {
        ['member' => $member, 'public' => $public] = $this->office();
        $original = $this->actingAs($member)->postJson("/api/channels/{$public->id}/messages", ['body' => 'first'])->json('id');
        $reply = $this->actingAs($member)->postJson("/api/channels/{$public->id}/messages", ['body' => 'second', 'reply_to' => $original])->json('id');

        $this->actingAs($member)->deleteJson("/api/messages/{$original}")->assertOk();

        $this->assertDatabaseHas('messages', ['id' => $reply, 'body' => 'second', 'reply_to' => null]);
    }
}
