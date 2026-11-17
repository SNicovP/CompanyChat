<?php

namespace App\Http\Resources;

use App\Models\Room;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Room */
class RoomResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'kind' => $this->kind,
            'channel_id' => $this->channel_id,
            'target_user_id' => $this->target_user_id,
            'started_by' => $this->started_by,
            'status' => $this->status,
            'created_at' => $this->created_at?->toISOString(),
            'ended_at' => $this->ended_at?->toISOString(),
            // who is in the room now (for announcements: the speaker and how many listen)
            'participants' => $this->isLive()
                ? $this->present()->map(fn ($u) => ['user_id' => $u->id, 'role' => $u->pivot->role])->values()->all()
                : [],
        ];
    }
}
