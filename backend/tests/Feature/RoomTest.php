<?php

namespace Tests\Feature;

use App\Events\RoomUpdated;
use App\Models\Channel;
use App\Models\Message;
use App\Models\Room;
use App\Models\User;
use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

class RoomTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
    }

    /** @return array{0: Channel, 1: User[]} a public project and $n people in its client */
    private function project(int $n): array
    {
        ['client' => $client, 'public' => $public] = $this->office();
        $people = User::factory()->count($n)->create();
        $client->members()->attach($people->pluck('id'));

        return [$public, $people->all()];
    }

    private function startCall(User $user, Channel $channel)
    {
        return $this->actingAs($user)->postJson('/api/rooms', ['kind' => 'call', 'channel_id' => $channel->id]);
    }

    public function test_a_group_call_in_a_project_channel(): void
    {
        Event::fake([RoomUpdated::class]);
        [$channel, [$a, $b, $c]] = $this->project(3);

        $id = $this->startCall($a, $channel)->assertCreated()
            ->assertJsonPath('room.kind', 'call')
            ->assertJsonPath('room.participants.0.user_id', $a->id)
            ->assertJsonPath('room.ice_servers.0.urls.0', 'stun:stun.l.google.com:19302')
            ->json('room.id');
        Event::assertDispatched(RoomUpdated::class, fn ($e) => $e->broadcastOn()[0]->name === "private-channel.{$channel->id}");

        // starting again in the same channel joins the call that is going
        $this->startCall($b, $channel)->assertOk()->assertJsonPath('room.id', $id)->assertJsonCount(2, 'room.participants');
        $this->actingAs($c)->postJson("/api/rooms/{$id}/join")->assertOk()->assertJsonCount(3, 'room.participants');
        $this->actingAs($c)->getJson('/api/rooms/live')->assertJsonPath('rooms.0.id', $id);

        $this->travel(2)->minutes();
        foreach ([$a, $b] as $u) {
            $this->actingAs($u)->postJson("/api/rooms/{$id}/ping");
        }
        $this->actingAs($a)->postJson("/api/rooms/{$id}/leave")->assertJsonPath('room.status', 'live');
        $this->actingAs($b)->postJson("/api/rooms/{$id}/leave")->assertJsonPath('room.status', 'ended'); // c went quiet

        $share = Message::query()->where('channel_id', $channel->id)->latest('created_at')->first()->share;
        $this->assertSame(['type' => 'group_call', 'duration' => 120, 'people' => 3], $share);
        $this->actingAs($c)->postJson("/api/rooms/{$id}/join")->assertConflict()->assertJsonPath('message', 'This call has ended.');
    }

    public function test_a_call_holds_six_and_nobody_can_be_in_two(): void
    {
        [$channel, $people] = $this->project(7);
        $id = $this->startCall($people[0], $channel)->json('room.id');
        foreach (array_slice($people, 1, 5) as $u) {
            $this->actingAs($u)->postJson("/api/rooms/{$id}/join")->assertOk();
        }
        $this->actingAs($people[6])->postJson("/api/rooms/{$id}/join")->assertConflict()->assertJsonPath('message', 'This call is full (6 people).');

        // in the group call, so busy for a 1:1 call and for another room
        $dm = Channel::factory()->dm()->create();
        $dm->members()->attach([$people[6]->id, $people[1]->id]);
        $this->actingAs($people[6])->postJson('/api/calls', ['channel_id' => $dm->id])->assertConflict();
        $this->actingAs($people[1])->postJson('/api/rooms', ['kind' => 'announcement', 'channel_id' => $channel->id])->assertConflict();
    }

    public function test_who_can_start_and_see_rooms(): void
    {
        ['member' => $member, 'admin' => $admin, 'outsider' => $outsider, 'public' => $public, 'private' => $private] = $this->office();

        $this->startCall($member, $private)->assertNotFound(); // not in the private project
        $dm = Channel::factory()->dm()->create();
        $dm->members()->attach([$member->id, $outsider->id]);
        $this->startCall($member, $dm)->assertForbidden(); // DMs have 1:1 calls

        $this->actingAs($member)->postJson('/api/rooms', ['kind' => 'announcement'])->assertForbidden()->assertJsonPath('message', 'Only admins can make an announcement to everyone.');
        $everyone = $this->actingAs($admin)->postJson('/api/rooms', ['kind' => 'announcement'])->assertCreated()->json('room.id');
        $call = $this->startCall($member, $public)->json('room.id');

        $this->actingAs($outsider)->getJson('/api/rooms/live')->assertJsonCount(1, 'rooms')->assertJsonPath('rooms.0.id', $everyone);
        $this->actingAs($outsider)->postJson("/api/rooms/{$call}/join")->assertNotFound();
    }

    public function test_an_announcement(): void
    {
        Event::fake([RoomUpdated::class]);
        [$channel, [$speaker, $l1, $l2]] = $this->project(3);

        $id = $this->actingAs($speaker)->postJson('/api/rooms', ['kind' => 'announcement', 'channel_id' => $channel->id])
            ->assertCreated()->assertJsonPath('room.participants.0.role', 'speaker')->json('room.id');
        $this->actingAs($l1)->postJson('/api/rooms', ['kind' => 'announcement', 'channel_id' => $channel->id])
            ->assertConflict()->assertJsonPath('message', "{$speaker->display_name} is already announcing here.");

        $this->actingAs($l1)->postJson("/api/rooms/{$id}/join")->assertOk();
        $this->actingAs($l2)->postJson("/api/rooms/{$id}/join")->assertOk()->assertJsonCount(3, 'room.participants');
        $this->actingAs($l1)->postJson("/api/rooms/{$id}/end")->assertForbidden(); // only the speaker ends it
        // listening is not "busy": a listener can still be called
        $dm = Channel::factory()->dm()->create();
        $dm->members()->attach([$l1->id, $l2->id]);
        $this->actingAs($l2)->postJson('/api/calls', ['channel_id' => $dm->id])->assertCreated();

        $this->actingAs($speaker)->postJson("/api/rooms/{$id}/end")->assertJsonPath('room.status', 'ended');
        Event::assertDispatched(RoomUpdated::class, fn ($e) => $e->room->status === 'ended');
        $this->assertSame(0, Message::query()->where('channel_id', $channel->id)->count()); // announcements leave no history
    }

    public function test_announcements_end_at_the_time_limit_or_when_the_speaker_goes_quiet(): void
    {
        [$channel, [$speaker, $listener]] = $this->project(2);
        $start = fn () => $this->actingAs($speaker)->postJson('/api/rooms', ['kind' => 'announcement', 'channel_id' => $channel->id])->json('room.id');

        $id = $start();
        for ($i = 0; $i < 6; $i++) { // keeps pinging, but runs into the limit
            $this->travel(60)->seconds();
            $this->actingAs($speaker)->postJson("/api/rooms/{$id}/ping");
        }
        $this->assertSame('ended', Room::find($id)->status);

        $id = $start();
        $this->travel(Room::STALE_SECONDS + 1)->seconds();
        $this->actingAs($listener)->postJson("/api/rooms/{$id}/join")->assertConflict()->assertJsonPath('message', 'This announcement has ended.');
    }

    public function test_only_people_in_the_room_can_join_its_presence_channel(): void
    {
        config(['broadcasting.default' => 'reverb', 'broadcasting.connections.reverb.key' => 'k', 'broadcasting.connections.reverb.secret' => 's', 'broadcasting.connections.reverb.app_id' => '1']);
        Broadcast::purge('reverb');
        require base_path('routes/channels.php');
        [$channel, [$a, $b]] = $this->project(2);

        $id = $this->startCall($a, $channel)->json('room.id');
        $auth = fn (User $u) => $this->actingAs($u)->postJson('/api/broadcasting/auth', ['socket_id' => '1.1', 'channel_name' => "presence-room.{$id}"]);

        $auth($a)->assertOk()->assertJsonPath('channel_data', fn ($d) => str_contains($d, '"role":"member"'));
        $auth($b)->assertForbidden(); // may join, but has not
        $this->actingAs($b)->postJson("/api/rooms/{$id}/join");
        $auth($b)->assertOk();
    }
}
