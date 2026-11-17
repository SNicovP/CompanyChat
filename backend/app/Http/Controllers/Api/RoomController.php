<?php

namespace App\Http\Controllers\Api;

use App\Events\RoomUpdated;
use App\Http\Controllers\Controller;
use App\Http\Resources\RoomResource;
use App\Jobs\ExpireRoom;
use App\Models\Channel;
use App\Models\Room;
use App\Models\User;
use App\Support\Access;
use App\Support\Calls;
use App\Support\Realtime;
use App\Support\Rooms;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Group calls (everyone in the room talks; up to Room::MAX_CALL people, each connected to each) and announcements
 * (one speaker, heard live by up to Room::MAX_LISTENERS online people in the audience). The server keeps who is in
 * the room; the apps connect the audio themselves over WebRTC, set up with whispers on presence-room.{id}.
 */
class RoomController extends Controller
{
    /** Live group calls and announcements this person could join or hear (for banners after the app opens). */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $rooms = Room::query()->live()->latest()->limit(200)->get()
            ->reject(fn (Room $r) => Rooms::expireIfStale($r))
            ->filter(fn (Room $r) => Rooms::audienceIncludes($r, $user))
            ->values();

        return response()->json(['rooms' => RoomResource::collection($rooms)->resolve()]);
    }

    /**
     * Start a group call in a project channel (or join the one already going there), or start an announcement to a
     * project channel or (admins, channel_id null) to everyone.
     */
    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate([
            'kind' => ['required', Rule::in([Room::CALL, Room::ANNOUNCEMENT])],
            'channel_id' => [Rule::requiredIf($request->input('kind') === Room::CALL), 'nullable', 'uuid'],
        ]);
        $channel = null;
        if (! empty($data['channel_id'])) {
            $channel = Channel::query()->find($data['channel_id']);
            abort_unless($channel && Access::canAccessChannel($user, $channel), 404);
        }
        abort_unless(Rooms::canStart($user, $data['kind'], $channel), 403, $channel
            ? 'Group calls and announcements are for project channels you can post in.'
            : 'Only admins can make an announcement to everyone.');

        $existing = Room::query()->live()->where('kind', $data['kind'])->where('channel_id', $channel?->id)->latest()->first();
        if ($existing && ! Rooms::expireIfStale($existing)) {
            abort_if($existing->isAnnouncement(), 409, User::query()->find($existing->started_by)?->display_name.' is already announcing here.');

            return $this->join($request, $existing); // a call is already going in this channel: join it
        }
        abort_if(Rooms::busy($user->id), 409, 'You are already on a call.');

        $room = DB::transaction(function () use ($user, $data, $channel) {
            $room = Room::create(['kind' => $data['kind'], 'channel_id' => $channel?->id, 'started_by' => $user->id]);
            Rooms::join($room, $user, $room->isCall() ? 'member' : 'speaker');

            return $room;
        });

        Realtime::send(new RoomUpdated($room));
        ExpireRoom::dispatch($room->id)->delay(now()->addSeconds($room->isAnnouncement() ? Room::ANNOUNCEMENT_MAX_SECONDS + 1 : Room::STALE_SECONDS + 5));

        return response()->json(['room' => $this->payload($room, $user)], 201);
    }

    /** Join a group call, or start listening to an announcement. */
    public function join(Request $request, Room $room): JsonResponse
    {
        $user = $request->user();
        abort_unless(Rooms::audienceIncludes($room, $user), 404);
        Rooms::expireIfStale($room);
        abort_unless($room->isLive(), 409, $room->isCall() ? 'This call has ended.' : 'This announcement has ended.');

        $present = $room->present();
        if ($room->isCall()) {
            if (! $present->contains('id', $user->id)) {
                abort_if(Rooms::busy($user->id), 409, 'You are already on a call.');
                abort_if($present->count() >= Room::MAX_CALL, 409, 'This call is full ('.Room::MAX_CALL.' people).');
            }
            Rooms::join($room, $user, 'member');
            Realtime::send(new RoomUpdated($room));
        } else {
            abort_if($room->started_by === $user->id, 409, 'You are the one announcing.');
            $listeners = $present->filter(fn ($u) => $u->pivot->role === 'listener');
            abort_if(! $listeners->contains('id', $user->id) && $listeners->count() >= Room::MAX_LISTENERS, 409, 'This announcement has as many listeners as it can take.');
            Rooms::join($room, $user, 'listener');
        }

        return response()->json(['room' => $this->payload($room, $user)]);
    }

    public function leave(Request $request, Room $room): JsonResponse
    {
        Rooms::leave($room, $request->user());

        return response()->json(['room' => (new RoomResource($room->refresh()))->resolve()]);
    }

    /** The speaker ends an announcement (anyone in a call just leaves it). */
    public function end(Request $request, Room $room): JsonResponse
    {
        abort_unless($room->started_by === $request->user()->id && $room->isAnnouncement(), 403);
        Rooms::end($room);

        return response()->json(['room' => (new RoomResource($room->refresh()))->resolve()]);
    }

    /** Heartbeat while in a room; also ends rooms that have gone quiet. */
    public function ping(Request $request, Room $room): JsonResponse
    {
        $user = $request->user();
        if ($room->isLive()) { // count this ping before deciding whether the room has gone quiet
            DB::table('room_participants')->where(['room_id' => $room->id, 'user_id' => $user->id])->whereNull('left_at')
                ->update(['last_seen_at' => now()]);
        }
        Rooms::expireIfStale($room);

        return response()->json(['room' => (new RoomResource($room->refresh()))->resolve()]);
    }

    private function payload(Room $room, User $user): array
    {
        return [...(new RoomResource($room))->resolve(), 'ice_servers' => Calls::iceServers($user)];
    }
}
