<?php

namespace App\Support;

use App\Models\Channel;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Blocking someone stops DMs, 1:1 calls and intercom between the two of you, in both directions. It is not private:
 * the blocked person sees that you blocked them.
 */
class Blocks
{
    public static function has(string $blockerId, string $blockedId): bool
    {
        return DB::table('user_blocks')->where(['blocker_id' => $blockerId, 'blocked_id' => $blockedId])->exists();
    }

    /** Why these two cannot reach each other, from $me's side; null if neither blocked the other. */
    public static function reason(User $me, User $other): ?string
    {
        if (self::has($me->id, $other->id)) {
            return "You blocked {$other->display_name}. Unblock them to message or call them.";
        }
        if (self::has($other->id, $me->id)) {
            return "{$other->display_name} has blocked you.";
        }

        return null;
    }

    /** The other person in a DM, if this is a DM and one of the two blocked the other: why. */
    public static function reasonInDm(User $me, Channel $channel): ?string
    {
        if (! $channel->isDm()) {
            return null;
        }
        $other = $channel->members()->where('users.id', '!=', $me->id)->first();

        return $other ? self::reason($me, $other) : null;
    }

    /** @return array{blocked: string[], blocked_by: string[]} */
    public static function of(User $user): array
    {
        return [
            'blocked' => DB::table('user_blocks')->where('blocker_id', $user->id)->pluck('blocked_id')->all(),
            'blocked_by' => DB::table('user_blocks')->where('blocked_id', $user->id)->pluck('blocker_id')->all(),
        ];
    }
}
