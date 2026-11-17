<?php

namespace Tests\Feature;

use App\Events\ChannelRead;
use App\Models\Channel;
use App\Models\User;
use Illuminate\Support\Facades\Event;
use Tests\TestCase;

/** The second tick: others' read markers, and the live event when someone opens a chat. */
class ReadReceiptTest extends TestCase
{
    public function test_reads_lists_the_other_people_only_and_respects_access(): void
    {
        $a = User::factory()->create();
        $b = User::factory()->create();
        $outsider = User::factory()->create();
        $dm = Channel::factory()->dm()->create();
        $dm->members()->attach([$a->id, $b->id]);

        $this->actingAs($b)->postJson("/api/channels/{$dm->id}/read")->assertOk();

        $res = $this->actingAs($a)->getJson("/api/channels/{$dm->id}/reads")->assertOk();
        $res->assertJsonCount(1);
        $res->assertJsonPath('0.user_id', $b->id);
        $this->assertMatchesRegularExpression('/^\d{4}-\d\d-\d\dT[\d:.]+Z$/', $res->json('0.read_at'));

        $this->actingAs($b)->getJson("/api/channels/{$dm->id}/reads")->assertOk()->assertJsonCount(0); // not my own marker
        $this->actingAs($outsider)->getJson("/api/channels/{$dm->id}/reads")->assertNotFound();
    }

    public function test_opening_a_chat_broadcasts_that_it_was_read(): void
    {
        Event::fake([ChannelRead::class]);
        $a = User::factory()->create();
        $b = User::factory()->create();
        $dm = Channel::factory()->dm()->create();
        $dm->members()->attach([$a->id, $b->id]);

        $this->actingAs($b)->postJson("/api/channels/{$dm->id}/read")->assertOk();

        Event::assertDispatched(ChannelRead::class, fn ($e) => $e->channelId === $dm->id && $e->userId === $b->id);
    }

    public function test_the_read_marker_never_moves_backwards(): void
    {
        $a = User::factory()->create();
        $b = User::factory()->create();
        $dm = Channel::factory()->dm()->create();
        $dm->members()->attach([$a->id, $b->id]);
        $marker = fn () => \Illuminate\Support\Facades\DB::table('channel_reads')->where(['user_id' => $b->id, 'channel_id' => $dm->id])->value('last_read_at');

        \Illuminate\Support\Carbon::setTestNow('2026-11-17 10:00:05.500000');
        $this->actingAs($b)->postJson("/api/channels/{$dm->id}/read")->assertOk();
        $newer = $marker();

        // an older request that finishes late (opened the chat, but was slower than the message-arrived one)
        \Illuminate\Support\Carbon::setTestNow('2026-11-17 10:00:04.100000');
        $this->actingAs($b)->postJson("/api/channels/{$dm->id}/read")->assertOk();
        $this->assertSame($newer, $marker());

        \Illuminate\Support\Carbon::setTestNow('2026-11-17 10:00:09.000000');
        $this->actingAs($b)->postJson("/api/channels/{$dm->id}/read")->assertOk();
        $this->assertGreaterThan($newer, $marker());
        \Illuminate\Support\Carbon::setTestNow();
    }
}
