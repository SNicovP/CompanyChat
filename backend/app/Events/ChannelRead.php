<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/** Someone opened a conversation: their messages up to read_at are now "read" (the second tick). */
class ChannelRead implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets;

    public function __construct(public string $channelId, public string $userId, public string $readAt) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel('channel.'.$this->channelId)];
    }

    public function broadcastAs(): string
    {
        return 'channel.read';
    }

    public function broadcastWith(): array
    {
        return ['channel_id' => $this->channelId, 'user_id' => $this->userId, 'read_at' => $this->readAt];
    }
}
