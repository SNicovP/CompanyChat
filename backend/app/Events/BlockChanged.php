<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/** Someone blocked or unblocked someone; both of them are told (blocking is not private). */
class BlockChanged implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets;

    public function __construct(public string $blockerId, public string $blockedId, public bool $blocked) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel('user.'.$this->blockerId), new PrivateChannel('user.'.$this->blockedId)];
    }

    public function broadcastAs(): string
    {
        return 'block.changed';
    }

    public function broadcastWith(): array
    {
        return ['blocker_id' => $this->blockerId, 'blocked_id' => $this->blockedId, 'blocked' => $this->blocked];
    }
}
