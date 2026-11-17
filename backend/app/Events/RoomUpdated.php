<?php

namespace App\Events;

use App\Http\Resources\RoomResource;
use App\Models\Room;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * A group call or announcement started, someone joined or left a call, or it ended. Heard by everyone who could
 * join: private-channel.{id} for a channel, private-user.{id} for an intercom, presence-office for an announcement
 * to everyone.
 */
class RoomUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets;

    public function __construct(public Room $room) {}

    public function broadcastOn(): array
    {
        return match (true) {
            (bool) $this->room->target_user_id => [new PrivateChannel('user.'.$this->room->target_user_id)], // intercom
            (bool) $this->room->channel_id => [new PrivateChannel('channel.'.$this->room->channel_id)],
            default => [new PresenceChannel('office')],
        };
    }

    public function broadcastAs(): string
    {
        return 'room.updated';
    }

    public function broadcastWith(): array
    {
        return ['room' => (new RoomResource($this->room))->resolve()];
    }
}
