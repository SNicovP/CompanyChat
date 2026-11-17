<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A 1:1 voice call in a DM.
 *
 * @property string $id
 * @property string $channel_id
 * @property string $caller_id
 * @property string $callee_id
 * @property string $status ringing|active|ended|missed|rejected|cancelled|failed
 * @property ?string $end_reason
 * @property ?Carbon $answered_at
 * @property ?Carbon $ended_at
 * @property Carbon $created_at
 * @property Carbon $updated_at
 */
class Call extends Model
{
    use HasUuids;

    /** How long a call rings before it counts as missed. */
    public const RING_SECONDS = 45;

    /** An active call whose clients have not pinged for this long is considered dead (crashed tab, lost network). */
    public const STALE_SECONDS = 90;

    public const RINGING = 'ringing';

    public const ACTIVE = 'active';

    public const ENDED = 'ended';

    public const MISSED = 'missed';

    public const REJECTED = 'rejected';

    public const CANCELLED = 'cancelled';

    public const FAILED = 'failed';

    protected $fillable = ['channel_id', 'caller_id', 'callee_id', 'status', 'end_reason', 'answered_at', 'ended_at'];

    protected function casts(): array
    {
        return [
            'answered_at' => 'datetime',
            'ended_at' => 'datetime',
        ];
    }

    public function channel(): BelongsTo
    {
        return $this->belongsTo(Channel::class);
    }

    public function caller(): BelongsTo
    {
        return $this->belongsTo(User::class, 'caller_id');
    }

    public function callee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'callee_id');
    }

    public function involves(User|string $user): bool
    {
        $id = $user instanceof User ? $user->id : $user;

        return $this->caller_id === $id || $this->callee_id === $id;
    }

    public function otherParty(User|string $user): string
    {
        $id = $user instanceof User ? $user->id : $user;

        return $this->caller_id === $id ? $this->callee_id : $this->caller_id;
    }

    /** Still ringing or in progress, and not abandoned (no answer in time, or no heartbeat). */
    public function isLive(): bool
    {
        return match ($this->status) {
            self::RINGING => $this->created_at->gt(now()->subSeconds(self::RING_SECONDS)),
            self::ACTIVE => $this->updated_at->gt(now()->subSeconds(self::STALE_SECONDS)),
            default => false,
        };
    }

    /** Ringing or active calls that have not been abandoned (see isLive). */
    public function scopeLive(Builder $query): Builder
    {
        return $query->where(fn (Builder $q) => $q
            ->where(fn (Builder $r) => $r->where('status', self::RINGING)->where('created_at', '>', now()->subSeconds(self::RING_SECONDS)))
            ->orWhere(fn (Builder $a) => $a->where('status', self::ACTIVE)->where('updated_at', '>', now()->subSeconds(self::STALE_SECONDS))));
    }

    public function scopeInvolving(Builder $query, string ...$userIds): Builder
    {
        return $query->where(fn (Builder $q) => $q->whereIn('caller_id', $userIds)->orWhereIn('callee_id', $userIds));
    }

    /** Whole seconds the call was connected, if it was answered. */
    public function duration(): ?int
    {
        if (! $this->answered_at) {
            return null;
        }

        return max(0, (int) $this->answered_at->diffInSeconds($this->ended_at ?? now(), true));
    }
}
