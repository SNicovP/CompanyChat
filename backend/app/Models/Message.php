<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * @property string $id
 * @property string $channel_id
 * @property ?string $user_id
 * @property ?string $reply_to
 * @property string $body
 */
class Message extends Model
{
    use HasFactory, HasUuids;

    public const MAX_BODY = 4000;

    protected $fillable = ['channel_id', 'user_id', 'body', 'reply_to'];

    protected $hidden = ['body_tsv', 'updated_at'];

    protected $dateFormat = 'Y-m-d H:i:s.u';

    protected function casts(): array
    {
        return [
            'created_at' => 'datetime',
            'edited_at' => 'datetime',
        ];
    }

    public function channel(): BelongsTo
    {
        return $this->belongsTo(Channel::class);
    }

    /** The message this one replies to. */
    public function replyTo(): BelongsTo
    {
        return $this->belongsTo(self::class, 'reply_to');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function attachments(): HasMany
    {
        return $this->hasMany(MessageAttachment::class)->orderBy('path');
    }
}
