<?php

namespace App\Support;

use App\Events\CallUpdated;
use App\Events\ChannelRead;
use App\Events\MessageCreated;
use App\Jobs\SendMessagePush;
use App\Models\Call;
use App\Models\Message;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/** Ending calls, and the call-history message each one leaves in the DM. */
class Calls
{
    /**
     * The ICE servers a client should use: STUN, plus the coturn relay when it is configured. TURN credentials follow
     * coturn's REST API scheme (use-auth-secret): username "<expiry>:<user id>", password base64(HMAC-SHA1(secret,
     * username)). coturn checks them with the same secret, so they need no database and stop working at the expiry.
     *
     * @return array<int, array{urls: string[], username?: string, credential?: string}>
     */
    public static function iceServers(User $user): array
    {
        $servers = [];
        if ($stun = config('services.webrtc.stun_urls', [])) {
            $servers[] = ['urls' => $stun];
        }
        if ($turn = self::turnServer($user)) {
            $servers[] = $turn;
        }

        return $servers;
    }

    /** @return ?array{urls: string[], username: string, credential: string} */
    public static function turnServer(User $user, ?int $now = null): ?array
    {
        $urls = config('services.coturn.urls', []);
        $secret = (string) config('services.coturn.secret');
        if (! $urls || $secret === '' || $secret === 'XXX') {
            return null;
        }
        $username = (($now ?? time()) + max(60, (int) config('services.coturn.ttl', 86400))).':'.$user->id;

        return [
            'urls' => $urls,
            'username' => $username,
            'credential' => base64_encode(hash_hmac('sha1', $username, $secret, true)),
        ];
    }

    /**
     * Move a live call to a final state, once: when both people hang up at the same moment only the first one counts.
     * Leaves a call-history message in the DM, tells both people, and pushes a missed call to the callee.
     *
     * @return bool false if the call had already ended
     */
    public static function finish(Call $call, string $status, ?string $reason = null): bool
    {
        $changed = DB::transaction(function () use ($call, $status, $reason) {
            $fresh = Call::query()->lockForUpdate()->find($call->id);
            if (! $fresh || ! in_array($fresh->status, [Call::RINGING, Call::ACTIVE], true)) {
                return false;
            }
            $fresh->status = $status;
            $fresh->end_reason = $reason;
            $fresh->ended_at = now();
            $fresh->save();
            $call->setRawAttributes($fresh->getAttributes(), true);

            return true;
        });
        if (! $changed) {
            $call->refresh();

            return false;
        }

        Realtime::send(new CallUpdated($call), toOthers: false);

        $message = Message::create([
            'channel_id' => $call->channel_id,
            'user_id' => $call->caller_id,
            'body' => '',
            'share' => array_filter(['type' => 'call', 'status' => $call->status, 'duration' => $call->duration()], fn ($v) => $v !== null),
        ]);
        $message->load('attachments');
        Realtime::send(new MessageCreated($message), toOthers: false);
        if ($call->status === Call::MISSED || $call->status === Call::CANCELLED) {
            SendMessagePush::dispatch($message->id)->afterCommit(); // "📞 Missed call" for the callee
        } elseif ($callee = User::query()->find($call->callee_id)) {
            // the callee took part (or declined): the history entry is not something new for them to read
            $readAt = Unread::markRead($callee, $call->channel_id);
            Realtime::send(new ChannelRead($call->channel_id, $callee->id, $readAt), toOthers: false);
        }

        return true;
    }

    /** End a call that was abandoned: unanswered in time, or no heartbeat from an active call. */
    public static function expireIfStale(Call $call): bool
    {
        if ($call->isLive()) {
            return false;
        }

        return match ($call->status) {
            Call::RINGING => self::finish($call, Call::MISSED, 'no_answer'),
            Call::ACTIVE => self::finish($call, Call::ENDED, 'lost'),
            default => false,
        };
    }
}
