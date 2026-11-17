<?php

namespace Tests\Feature;

use App\Events\CallInvited;
use App\Events\CallUpdated;
use App\Events\MessageCreated;
use App\Jobs\ExpireCall;
use App\Jobs\SendCallPush;
use App\Jobs\SendMessagePush;
use App\Models\Call;
use App\Models\Channel;
use App\Models\Message;
use App\Models\User;
use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

class CallTest extends TestCase
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

    private function startCall(?User $from = null, ?Channel $in = null)
    {
        return $this->actingAs($from ?? $this->pat)->postJson('/api/calls', ['channel_id' => ($in ?? $this->dm)->id]);
    }

    private function callHistory(): ?array
    {
        return Message::query()->where('channel_id', $this->dm->id)->latest('created_at')->first()?->share;
    }

    public function test_a_call_rings_the_other_person_and_can_be_answered_and_hung_up(): void
    {
        Event::fake([CallInvited::class, CallUpdated::class, MessageCreated::class]);

        $id = $this->startCall()->assertCreated()
            ->assertJsonPath('call.status', 'ringing')
            ->assertJsonPath('call.callee_id', $this->sam->id)
            ->assertJsonPath('call.ice_servers.0.urls.0', 'stun:stun.l.google.com:19302')
            ->json('call.id');
        Event::assertDispatched(CallInvited::class, fn ($e) => $e->call->id === $id && $e->broadcastOn()[0]->name === "private-user.{$this->sam->id}");
        Queue::assertPushed(SendCallPush::class);
        Queue::assertPushed(ExpireCall::class);

        $this->actingAs($this->pat)->postJson("/api/calls/{$id}/accept")->assertNotFound(); // only the callee answers
        $this->actingAs($this->sam)->postJson("/api/calls/{$id}/accept")->assertOk()->assertJsonPath('call.status', 'active');
        Event::assertDispatched(CallUpdated::class, fn ($e) => $e->call->status === 'active');
        $this->actingAs($this->sam)->postJson("/api/calls/{$id}/accept")->assertConflict()->assertJsonPath('message', 'This call was answered on another device.');

        $this->travel(65)->seconds();
        $this->actingAs($this->pat)->postJson("/api/calls/{$id}/end")->assertOk()->assertJsonPath('call.status', 'ended');
        $this->assertSame(['type' => 'call', 'status' => 'ended', 'duration' => 65], $this->callHistory());
        Event::assertDispatched(MessageCreated::class);
        Queue::assertNotPushed(SendMessagePush::class); // an answered call is not a missed call
        $this->actingAs($this->sam)->getJson('/api/unread')->assertJsonMissingPath("unread.{$this->dm->id}"); // nor unread

        // hanging up twice is harmless and leaves one history entry
        $this->actingAs($this->sam)->postJson("/api/calls/{$id}/end")->assertOk()->assertJsonPath('call.status', 'ended');
        $this->assertSame(1, Message::query()->where('channel_id', $this->dm->id)->count());
    }

    public function test_declining_cancelling_and_failing(): void
    {
        $id = $this->startCall()->json('call.id');
        $this->actingAs($this->sam)->postJson("/api/calls/{$id}/reject")->assertOk()->assertJsonPath('call.status', 'rejected');
        $this->assertSame('rejected', $this->callHistory()['status']);

        $id = $this->startCall()->json('call.id');
        $this->actingAs($this->pat)->postJson("/api/calls/{$id}/end")->assertJsonPath('call.status', 'cancelled');
        Queue::assertPushed(SendMessagePush::class); // the callee hears about the missed call
        $this->actingAs($this->sam)->getJson('/api/unread')->assertJsonPath("unread.{$this->dm->id}", 1);
        $this->actingAs($this->sam)->postJson("/api/calls/{$id}/accept")->assertConflict()->assertJsonPath('message', 'The caller hung up.');

        $id = $this->startCall()->json('call.id');
        $this->actingAs($this->sam)->postJson("/api/calls/{$id}/accept")->assertOk();
        $this->actingAs($this->sam)->postJson("/api/calls/{$id}/end", ['reason' => 'failed'])->assertJsonPath('call.status', 'failed');
        $this->assertSame(['type' => 'call', 'status' => 'failed', 'duration' => 0], $this->callHistory());
    }

    public function test_an_unanswered_call_becomes_missed(): void
    {
        $id = $this->startCall()->json('call.id');

        (new ExpireCall($id))->handle(); // a queue without delays runs it at once: still in time, left alone
        $this->assertSame('ringing', Call::find($id)->status);

        $this->travel(Call::RING_SECONDS + 1)->seconds();
        (new ExpireCall($id))->handle();
        $this->assertSame('missed', Call::find($id)->status);
        $this->assertSame(['type' => 'call', 'status' => 'missed'], $this->callHistory());
        $this->actingAs($this->sam)->postJson("/api/calls/{$id}/accept")->assertConflict();
    }

    public function test_busy_and_abandoned_calls(): void
    {
        $other = User::factory()->create();
        $dm2 = Channel::factory()->dm()->create();
        $dm2->members()->attach([$other->id, $this->sam->id]);

        $id = $this->startCall()->assertCreated()->json('call.id');
        $this->startCall($other, $dm2)->assertConflict()->assertJsonPath('message', "{$this->sam->display_name} is on another call.");
        $this->startCall()->assertConflict()->assertJsonPath('message', 'You are already on a call.');

        $this->actingAs($this->sam)->postJson("/api/calls/{$id}/accept")->assertOk();
        $this->travel(60)->seconds();
        $this->actingAs($this->pat)->postJson("/api/calls/{$id}/ping")->assertJsonPath('call.status', 'active');
        $this->travel(60)->seconds();
        $this->startCall($other, $dm2)->assertConflict(); // pinged a minute ago: still on the call

        // both apps went away without hanging up: the call no longer keeps Sam busy
        $this->travel(Call::STALE_SECONDS + 1)->seconds();
        $this->actingAs($this->sam)->getJson('/api/calls/current')->assertJsonPath('call', null);
        $this->startCall($other, $dm2)->assertCreated();
        $this->assertSame(['ended', 'lost'], [Call::find($id)->status, Call::find($id)->end_reason]);
    }

    public function test_only_dms_with_an_active_person_can_be_called(): void
    {
        ['member' => $member, 'public' => $public] = $this->office();
        $this->startCall($member, $public)->assertUnprocessable();
        $this->startCall(User::factory()->create())->assertNotFound(); // not in the DM

        $this->sam->forceFill(['is_active' => false])->save();
        $this->startCall()->assertUnprocessable();
    }

    public function test_current_call_and_call_strangers_cannot_touch(): void
    {
        $id = $this->startCall()->json('call.id');
        $this->actingAs($this->sam)->getJson('/api/calls/current')->assertJsonPath('call.id', $id)->assertJsonPath('call.status', 'ringing');

        $stranger = User::factory()->create();
        $this->actingAs($stranger)->getJson('/api/calls/current')->assertJsonPath('call', null);
        foreach (['accept', 'reject', 'end', 'ping'] as $action) {
            $this->actingAs($stranger)->postJson("/api/calls/{$id}/{$action}")->assertNotFound();
        }
    }

    public function test_only_the_two_people_on_a_live_call_can_join_its_channel(): void
    {
        config(['broadcasting.default' => 'reverb', 'broadcasting.connections.reverb.key' => 'k', 'broadcasting.connections.reverb.secret' => 's', 'broadcasting.connections.reverb.app_id' => '1']);
        Broadcast::purge('reverb');
        require base_path('routes/channels.php');

        $id = $this->startCall()->json('call.id');
        $auth = fn (User $u) => $this->actingAs($u)->postJson('/api/broadcasting/auth', ['socket_id' => '1.1', 'channel_name' => "private-call.{$id}"]);

        $auth($this->pat)->assertOk();
        $auth($this->sam)->assertOk();
        $auth(User::factory()->create())->assertForbidden();

        $this->actingAs($this->pat)->postJson("/api/calls/{$id}/end");
        $auth($this->sam)->assertForbidden(); // over
    }

    public function test_turn_credentials_are_short_lived_and_signed_with_the_coturn_secret(): void
    {
        $first = $this->startCall()->assertJsonCount(1, 'call.ice_servers')->json('call.id'); // STUN only until coturn is configured
        $this->actingAs($this->pat)->postJson("/api/calls/{$first}/end");

        config(['services.coturn.urls' => ['turn:turn.example.com:3478?transport=udp', 'turns:turn.example.com:5349'], 'services.coturn.secret' => 's3cret', 'services.coturn.ttl' => 3600]);
        $turn = \App\Support\Calls::turnServer($this->pat, 1_000_000);
        $this->assertSame("1003600:{$this->pat->id}", $turn['username']);
        $this->assertSame(base64_encode(hash_hmac('sha1', $turn['username'], 's3cret', true)), $turn['credential']);
        $this->assertSame(['turn:turn.example.com:3478?transport=udp', 'turns:turn.example.com:5349'], $turn['urls']);

        // each person gets credentials of their own; the secret itself is never sent
        $res = $this->actingAs($this->sam)->postJson('/api/calls', ['channel_id' => $this->dm->id])->assertCreated();
        $this->assertStringEndsWith(":{$this->sam->id}", $res->json('call.ice_servers.1.username'));
        $this->assertStringNotContainsString('s3cret', $res->getContent());
    }
}
