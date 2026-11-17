<?php

namespace App\Support;

use App\Events\MessageCreated;
use App\Events\RoomUpdated;
use App\Models\Call;
use App\Models\Channel;
use App\Models\Message;
use App\Models\Room;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/** Who may start, hear and join group calls and announcements, and ending them. */
class Rooms
{
    /** Can this person start a room of this kind for this channel (null: announcement to everyone)? */
    public static function canStart(User $user, string $kind, ?Channel $channel): bool
    {
        if (! $user->is_active) {
            return false;
        }
        if (! $channel) {
            return $kind === Room::ANNOUNCEMENT && $user->isAdmin();
        }

        return $channel->isProject() && Access::canPostInChannel($user, $channel);
    }

    /** Is this person in the room's audience (may see it, and join or listen)? */
    public static function audienceIncludes(Room $room, User $user): bool
    {
        if (! $user->is_active) {
            return false;
        }

        return $room->channel_id ? Access::canAccessChannel($user, $room->channel_id) : true;
    }

    /** Talking somewhere already: on a 1:1 call, in a group call, or announcing. Listening does not count. */
    public static function busy(string ...$userIds): bool
    {
        if (Call::query()->live()->involving(...$userIds)->exists()) {
            return true;
        }

        return DB::table('room_participants')
            ->join('rooms', 'rooms.id', '=', 'room_participants.room_id')
            ->where('rooms.status', 'live')
            ->whereIn('room_participants.user_id', $userIds)
            ->whereIn('room_participants.role', ['member', 'speaker'])
            ->whereNull('room_participants.left_at')
            ->where('room_participants.last_seen_at', '>', now()->subSeconds(Room::STALE_SECONDS))
            ->exists();
    }

    /** Add (or bring back) a person; refreshes their heartbeat. */
    public static function join(Room $room, User $user, string $role): void
    {
        $now = now();
        $row = ['room_id' => $room->id, 'user_id' => $user->id];
        DB::table('room_participants')->insertOrIgnore([...$row, 'role' => $role, 'joined_at' => $now, 'last_seen_at' => $now]);
        DB::table('room_participants')->where($row)->update(['role' => $role, 'left_at' => null, 'last_seen_at' => $now]);
    }

    /** A person leaves. A call with nobody left, or an announcement whose speaker left, ends. */
    public static function leave(Room $room, User $user): void
    {
        DB::table('room_participants')->where(['room_id' => $room->id, 'user_id' => $user->id])->whereNull('left_at')
            ->update(['left_at' => now()]);
        if (! $room->isLive()) {
            return;
        }
        if (($room->isAnnouncement() && $room->started_by === $user->id) || ($room->isCall() && $room->present()->isEmpty())) {
            self::end($room);

            return;
        }
        if ($room->isCall()) {
            Realtime::send(new RoomUpdated($room), toOthers: false);
        }
    }

    /** End a room once; a group call leaves a history entry in its channel. */
    public static function end(Room $room): bool
    {
        $ended = DB::transaction(function () use ($room) {
            $fresh = Room::query()->lockForUpdate()->find($room->id);
            if (! $fresh || ! $fresh->isLive()) {
                return false;
            }
            $fresh->update(['status' => 'ended', 'ended_at' => now()]);
            DB::table('room_participants')->where('room_id', $room->id)->whereNull('left_at')->update(['left_at' => now()]);
            $room->setRawAttributes($fresh->getAttributes(), true);

            return true;
        });
        if (! $ended) {
            $room->refresh();

            return false;
        }

        Realtime::send(new RoomUpdated($room), toOthers: false);

        if ($room->isCall() && $room->channel_id) {
            $people = DB::table('room_participants')->where('room_id', $room->id)->count();
            $message = Message::create([
                'channel_id' => $room->channel_id,
                'user_id' => $room->started_by,
                'body' => '',
                'share' => [
                    'type' => 'group_call',
                    'duration' => max(0, (int) $room->created_at->diffInSeconds($room->ended_at, true)),
                    'people' => $people,
                ],
            ]);
            $message->load('attachments');
            Realtime::send(new MessageCreated($message), toOthers: false);
        }

        return true;
    }

    /** End a room nobody is in any more, or an announcement past its time limit or without its speaker. */
    public static function expireIfStale(Room $room): bool
    {
        if (! $room->isLive()) {
            return false;
        }
        $present = $room->present();
        $stale = $room->isCall()
            ? $present->isEmpty() && $room->created_at->lt(now()->subSeconds(10)) // the starter is still joining
            : ! $present->contains('id', $room->started_by)
                || $room->created_at->lt(now()->subSeconds(Room::ANNOUNCEMENT_MAX_SECONDS));

        return $stale && self::end($room);
    }
}
