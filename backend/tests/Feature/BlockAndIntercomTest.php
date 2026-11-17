<?php

namespace Tests\Feature;

use App\Events\BlockChanged;
use App\Events\RoomUpdated;
use App\Models\Channel;
use App\Models\User;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

class BlockAndIntercomTest extends TestCase
{
    private User $pat;

    private User $sam;

    private Channel $dm;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        $this->pat = User::factory()->create();
        $this->sam = User::factory()->create();
        $this->dm = Channel::factory()->dm()->create();
        $this->dm->members()->attach([$this->pat->id, $this->sam->id]);
    }

    public function test_blocking_stops_messages_and_calls_both_ways_and_both_can_see_it(): void
    {
        Event::fake([BlockChanged::class]);
        $this->actingAs($this->pat)->putJson("/api/users/{$this->sam->id}/block")->assertOk()->assertJsonPath('blocked', [$this->sam->id]);
        Event::assertDispatched(BlockChanged::class, fn ($e) => $e->blocked && count($e->broadcastOn()) === 2);
        $this->actingAs($this->sam)->getJson('/api/blocks')->assertJsonPath('blocked_by', [$this->pat->id]);

        $this->actingAs($this->sam)->postJson("/api/channels/{$this->dm->id}/messages", ['body' => 'hi'])
            ->assertForbidden()->assertJsonPath('message', "{$this->pat->display_name} has blocked you.");
        $this->actingAs($this->pat)->postJson("/api/channels/{$this->dm->id}/messages", ['body' => 'hi'])
            ->assertForbidden()->assertJsonPath('message', "You blocked {$this->sam->display_name}. Unblock them to message or call them.");
        $this->actingAs($this->sam)->postJson('/api/calls', ['channel_id' => $this->dm->id])->assertForbidden();
        $this->actingAs($this->pat)->getJson("/api/channels/{$this->dm->id}/messages")->assertOk(); // history stays readable

        $this->actingAs($this->sam)->deleteJson("/api/users/{$this->pat->id}/block")->assertOk(); // only Pat can lift it
        $this->actingAs($this->sam)->postJson("/api/channels/{$this->dm->id}/messages", ['body' => 'hi'])->assertForbidden();
        $this->actingAs($this->pat)->deleteJson("/api/users/{$this->sam->id}/block")->assertOk()->assertJsonPath('blocked', []);
        $this->actingAs($this->sam)->postJson("/api/channels/{$this->dm->id}/messages", ['body' => 'hi'])->assertCreated();

        $this->actingAs($this->pat)->putJson("/api/users/{$this->pat->id}/block")->assertUnprocessable();
    }

    public function test_blocks_do_not_touch_project_channels(): void
    {
        ['member' => $member, 'client' => $client, 'public' => $public] = $this->office();
        $client->members()->attach($this->sam->id);
        $this->actingAs($member)->putJson("/api/users/{$this->sam->id}/block");
        $this->actingAs($this->sam)->postJson("/api/channels/{$public->id}/messages", ['body' => 'all hands'])->assertCreated();
    }

    public function test_an_admin_can_intercom_one_person(): void
    {
        Event::fake([RoomUpdated::class]);
        $admin = User::factory()->admin()->create();
        $start = fn (User $from, User $to) => $this->actingAs($from)->postJson('/api/rooms', ['kind' => 'announcement', 'target_user_id' => $to->id]);

        $start($this->pat, $this->sam)->assertForbidden()->assertJsonPath('message', 'Only admins can use the intercom.');

        $id = $start($admin, $this->sam)->assertCreated()->assertJsonPath('room.target_user_id', $this->sam->id)->json('room.id');
        Event::assertDispatched(RoomUpdated::class, fn ($e) => $e->broadcastOn()[0]->name === "private-user.{$this->sam->id}");
        // only Sam hears it
        $this->actingAs($this->pat)->getJson('/api/rooms/live')->assertJsonCount(0, 'rooms');
        $this->actingAs($this->pat)->postJson("/api/rooms/{$id}/join")->assertNotFound();
        $this->actingAs($this->sam)->getJson('/api/rooms/live')->assertJsonPath('rooms.0.id', $id);
        $roles = $this->actingAs($this->sam)->postJson("/api/rooms/{$id}/join")->assertOk()->json('room.participants');
        $this->assertEqualsCanonicalizing([[$admin->id, 'speaker'], [$this->sam->id, 'listener']], array_map(fn ($p) => [$p['user_id'], $p['role']], $roles));
        $this->actingAs($admin)->postJson("/api/rooms/{$id}/end")->assertJsonPath('room.status', 'ended');
    }

    public function test_intercom_respects_blocks_do_not_disturb_and_busy(): void
    {
        $admin = User::factory()->admin()->create();
        $start = fn (User $to) => $this->actingAs($admin)->postJson('/api/rooms', ['kind' => 'announcement', 'target_user_id' => $to->id]);

        $this->actingAs($this->sam)->putJson("/api/users/{$admin->id}/block");
        $start($this->sam)->assertForbidden()->assertJsonPath('message', "{$this->sam->display_name} has blocked you.");

        $this->pat->forceFill(['status' => 'dnd'])->save();
        $start($this->pat)->assertConflict()->assertJsonPath('message', "{$this->pat->display_name} is on Do not disturb.");

        $this->pat->forceFill(['status' => 'online'])->save();
        $this->actingAs($this->sam)->deleteJson("/api/users/{$admin->id}/block");
        $this->actingAs($this->pat)->postJson('/api/calls', ['channel_id' => $this->dm->id])->assertCreated();
        $start($this->pat)->assertConflict()->assertJsonPath('message', "{$this->pat->display_name} is on a call.");

        $this->actingAs($admin)->postJson('/api/rooms', ['kind' => 'call', 'target_user_id' => $this->sam->id, 'channel_id' => $this->dm->id])->assertUnprocessable();
    }
}
