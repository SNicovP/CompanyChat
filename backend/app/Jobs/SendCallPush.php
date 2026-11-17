<?php

namespace App\Jobs;

use App\Enums\UserStatus;
use App\Models\Call;
use App\Support\PushSender;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/** "Incoming call" push for a callee whose app is in the background or closed. Only useful while it still rings. */
class SendCallPush implements ShouldQueue
{
    use Queueable;

    public function __construct(public string $callId) {}

    public function handle(): void
    {
        $call = Call::with('caller', 'callee')->find($this->callId);
        if (! $call || $call->status !== Call::RINGING || ! $call->isLive() || ! PushSender::configured()) {
            return;
        }
        if (! $call->callee->is_active || $call->callee->status === UserStatus::Dnd) {
            return; // Do not disturb: the call still rings in an open app, and leaves a missed call
        }

        $left = max(5, Call::RING_SECONDS - (int) $call->created_at->diffInSeconds(now(), true));
        PushSender::send([$call->callee_id], fn () => [
            'title' => $call->caller->display_name,
            'body' => '📞 Incoming voice call',
            'tag' => 'call-'.$call->id,
            'url' => "/c/{$call->channel_id}",
        ], ttl: $left);
    }
}
