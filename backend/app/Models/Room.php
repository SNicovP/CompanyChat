<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * A group call in a project channel, or an announcement (one speaker, live to a channel or to everyone).
 *
 * @property string $id
 * @property string $kind call|announcement
 * @property ?string $channel_id
 * @property ?string $target_user_id intercom: the one person who hears the announcement
 * @property string $started_by
 * @property string $status live|ended
 * @property ?Carbon $ended_at
 * @property Carbon $created_at
 */
class Room extends Model
{
    use HasUuids;

    public const CALL = 'call';

    public const ANNOUNCEMENT = 'announcement';

    /** Everyone sends their audio to everyone else, so a call stays small. */
    public const MAX_CALL = 6;

    /** The speaker sends one stream per listener. */
    public const MAX_LISTENERS = 30;

    public const ANNOUNCEMENT_MAX_SECONDS = 300;

    /** A participant whose app has not pinged for this long has left (closed tab, lost network). */
    public const STALE_SECONDS = 90;

    protected $fillable = ['kind', 'channel_id', 'target_user_id', 'started_by', 'status', 'ended_at'];

    protected $attributes = ['status' => 'live'];

    protected function casts(): array
    {
        return ['ended_at' => 'datetime'];
    }

    public function channel(): BelongsTo
    {
        return $this->belongsTo(Channel::class);
    }

    public function starter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'started_by');
    }

    public function participants(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'room_participants')
            ->withPivot('role', 'joined_at', 'left_at', 'last_seen_at');
    }

    public function isCall(): bool
    {
        return $this->kind === self::CALL;
    }

    public function isAnnouncement(): bool
    {
        return $this->kind === self::ANNOUNCEMENT;
    }

    public function isLive(): bool
    {
        return $this->status === 'live';
    }

    public function scopeLive(Builder $query): Builder
    {
        return $query->where('status', 'live');
    }

    /** People in the room now: joined, not left, and still pinging. */
    public function present(): Collection
    {
        return $this->participants()
            ->wherePivotNull('left_at')
            ->wherePivot('last_seen_at', '>', now()->subSeconds(self::STALE_SECONDS))
            ->get();
    }

    public function isPresent(User|string $user): bool
    {
        $id = $user instanceof User ? $user->id : $user;

        return $this->present()->contains('id', $id);
    }

    public function speakerId(): ?string
    {
        return $this->isAnnouncement() ? $this->started_by : null;
    }
}
