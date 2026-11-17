<?php

namespace App\Http\Controllers\Api;

use App\Events\CallInvited;
use App\Events\CallUpdated;
use App\Http\Controllers\Controller;
use App\Http\Resources\CallResource;
use App\Jobs\ExpireCall;
use App\Jobs\SendCallPush;
use App\Models\Call;
use App\Models\Channel;
use App\Support\Access;
use App\Support\Calls;
use App\Support\Realtime;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * 1:1 voice calls in a DM. The server rings the other person and keeps the call's state; the two apps then set up
 * the audio themselves (WebRTC offer/answer and ICE candidates as whispers on private-call.{id}).
 *
 *   ringing --accept--> active --end--> ended
 *      |--reject--> rejected     |--end(failed)--> failed
 *      |--end (caller)--> cancelled
 *      '--no answer in RING_SECONDS--> missed
 */
class CallController extends Controller
{
    /** The caller's or callee's live call, if any (an app that reloads mid-call or mid-ring picks it up here). */
    public function current(Request $request): JsonResponse
    {
        $user = $request->user();
        $call = Call::query()->live()->involving($user->id)->latest()->first();

        return response()->json(['call' => $call ? $this->payload($call, $user) : null]);
    }

    /** Call the other person in a DM. 409 when either of you is already on a call. */
    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate(['channel_id' => ['required', 'uuid']]);
        $channel = Channel::query()->find($data['channel_id']);
        abort_unless($channel && Access::canAccessChannel($user, $channel), 404);
        abort_unless($channel->isDm() && Access::canPostInChannel($user, $channel), 422, 'Calls are only possible in direct messages.');

        $other = $channel->members()->where('users.id', '!=', $user->id)->first();
        abort_unless($other && $other->is_active, 422, 'This person can no longer be called.');

        $call = DB::transaction(function () use ($user, $other, $channel) {
            // abandoned calls (closed tab, lost network) must not keep anyone "busy"
            foreach (Call::query()->whereIn('status', [Call::RINGING, Call::ACTIVE])->involving($user->id, $other->id)->lockForUpdate()->get() as $old) {
                Calls::expireIfStale($old);
            }
            $busy = Call::query()->live()->involving($user->id, $other->id)->get();
            abort_if($busy->contains(fn (Call $c) => $c->involves($user)), 409, 'You are already on a call.');
            abort_if($busy->isNotEmpty(), 409, "{$other->display_name} is on another call.");

            return Call::create(['channel_id' => $channel->id, 'caller_id' => $user->id, 'callee_id' => $other->id, 'status' => Call::RINGING]);
        });

        Realtime::send(new CallInvited($call), toOthers: false);
        SendCallPush::dispatch($call->id);
        ExpireCall::dispatch($call->id)->delay(now()->addSeconds(Call::RING_SECONDS + 1));

        return response()->json(['call' => $this->payload($call, $user)], 201);
    }

    /** The callee answers (on one device; their other devices stop ringing). */
    public function accept(Request $request, Call $call): JsonResponse
    {
        $user = $request->user();
        abort_unless($call->callee_id === $user->id, 404);
        Calls::expireIfStale($call);

        $answered = DB::transaction(function () use ($call) {
            $fresh = Call::query()->lockForUpdate()->find($call->id);
            if ($fresh->status !== Call::RINGING) {
                return false;
            }
            $fresh->update(['status' => Call::ACTIVE, 'answered_at' => now()]);
            $call->setRawAttributes($fresh->getAttributes(), true);

            return true;
        });
        abort_unless($answered, 409, $this->goneMessage($call->refresh()));

        Realtime::send(new CallUpdated($call));

        return response()->json(['call' => $this->payload($call, $user)]);
    }

    /** The callee declines. */
    public function reject(Request $request, Call $call): JsonResponse
    {
        $user = $request->user();
        abort_unless($call->callee_id === $user->id, 404);
        if ($call->status === Call::RINGING) {
            Calls::finish($call, Call::REJECTED, 'declined');
        }

        return response()->json(['call' => new CallResource($call->refresh())]);
    }

    /**
     * Either person hangs up. While ringing this cancels (caller) or declines (callee). reason=failed when the
     * two devices could not connect (the app shows "Couldn't connect").
     */
    public function end(Request $request, Call $call): JsonResponse
    {
        $user = $request->user();
        abort_unless($call->involves($user), 404);
        $data = $request->validate(['reason' => ['nullable', Rule::in(['hangup', 'failed'])]]);
        $failed = ($data['reason'] ?? null) === 'failed';

        match ($call->status) {
            Call::RINGING => $call->caller_id === $user->id
                ? Calls::finish($call, $failed ? Call::FAILED : Call::CANCELLED, $failed ? 'failed' : 'cancelled')
                : Calls::finish($call, Call::REJECTED, 'declined'),
            Call::ACTIVE => Calls::finish($call, $failed ? Call::FAILED : Call::ENDED, $failed ? 'failed' : 'hangup'),
            default => null, // already over: hanging up twice is fine
        };

        return response()->json(['call' => new CallResource($call->refresh())]);
    }

    /** Heartbeat from an app in an active call, so a crashed app's call does not leave anyone "busy" for long. */
    public function ping(Request $request, Call $call): JsonResponse
    {
        abort_unless($call->involves($request->user()), 404);
        if ($call->status === Call::ACTIVE && ! Calls::expireIfStale($call)) {
            $call->touch();
        }

        return response()->json(['call' => new CallResource($call->refresh())]);
    }

    private function payload(Call $call, $user): array
    {
        return [...(new CallResource($call))->resolve(), 'ice_servers' => Calls::iceServers($user)];
    }

    private function goneMessage(Call $call): string
    {
        return match ($call->status) {
            Call::ACTIVE => 'This call was answered on another device.',
            Call::CANCELLED, Call::MISSED => 'The caller hung up.',
            default => 'This call has ended.',
        };
    }
}
