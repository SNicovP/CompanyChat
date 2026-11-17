<?php

namespace App\Jobs;

use App\Models\Room;
use App\Support\Rooms;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/** Ends an announcement at its time limit, or a room whose people all went away without leaving. */
class ExpireRoom implements ShouldQueue
{
    use Queueable;

    public function __construct(public string $roomId) {}

    public function handle(): void
    {
        $room = Room::query()->find($this->roomId);
        if ($room && $room->isLive()) {
            Rooms::expireIfStale($room);
        }
    }
}
