<?php

use App\Models\Call;
use App\Models\Room;
use App\Models\User;
use App\Support\Access;
use Illuminate\Support\Facades\Broadcast;

/*
| Reverb channels (replaces Supabase Realtime). Authorised at POST /api/broadcasting/auth with the
| same bearer token as the REST API.
|
|   presence-office         everyone online; profile.updated, directory.changed
|   private-channel.{id}    message.created, message.updated, message.deleted
|   private-user.{id}       mention.created, call.invited, call.updated (only for you)
|   private-call.{id}       WebRTC set-up whispers (ready, offer, answer, ice) between the two people on a call
|   presence-room.{id}      who is in a group call or announcement, and WebRTC set-up whispers addressed to one of them
|   (room.updated is sent on private-channel.{id}, or presence-office for announcements to everyone)
*/

Broadcast::channel('office', function (User $user) {
    if (! $user->is_active) {
        return false;
    }

    return ['id' => $user->id, 'display_name' => $user->display_name];
});

Broadcast::channel('channel.{channelId}', function (User $user, string $channelId) {
    return Access::canAccessChannel($user, $channelId);
});

Broadcast::channel('user.{id}', function (User $user, string $id) {
    return $user->is_active && $user->id === $id;
});

Broadcast::channel('call.{callId}', function (User $user, string $callId) {
    $call = Call::query()->find($callId);

    return $user->is_active && $call && $call->involves($user) && $call->isLive();
});

Broadcast::channel('room.{roomId}', function (User $user, string $roomId) {
    $room = Room::query()->find($roomId);
    if (! $user->is_active || ! $room || ! $room->isLive()) {
        return false;
    }
    $me = $room->present()->firstWhere('id', $user->id);

    return $me ? ['id' => $user->id, 'display_name' => $user->display_name, 'role' => $me->pivot->role] : false;
});
