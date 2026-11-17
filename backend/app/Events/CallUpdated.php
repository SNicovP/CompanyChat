<?php

namespace App\Events;

use App\Http\Resources\CallResource;
use App\Models\Call;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * A call was answered or ended. Sent to every device of both people (private-user.{id}), so the other side
 * hangs up and the callee's other devices stop ringing.
 */
class CallUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets;

    public function __construct(public Call $call) {}

    public function broadcastOn(): array
    {
        return [
            new PrivateChannel('user.'.$this->call->caller_id),
            new PrivateChannel('user.'.$this->call->callee_id),
        ];
    }

    public function broadcastAs(): string
    {
        return 'call.updated';
    }

    public function broadcastWith(): array
    {
        return ['call' => (new CallResource($this->call))->resolve()];
    }
}
