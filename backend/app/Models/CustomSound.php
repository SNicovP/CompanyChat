<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A sound someone uploaded to use as a notification tone or ringtone (see CustomSoundController).
 *
 * @property string $id
 * @property string $user_id
 * @property string $name
 * @property string $path
 * @property string $mime_type
 * @property int $size_bytes
 * @property Carbon $created_at
 * @property Carbon $updated_at
 */
class CustomSound extends Model
{
    use HasUuids;

    /** Small enough to keep every sound in memory on each device and play it instantly. */
    public const MAX_KB = 1024;

    public const MAX_PER_USER = 10;

    /** What notification_tones stores for this sound. */
    public const PREFIX = 'custom:';

    /** Audio types browsers play; the extension must match one of them too. */
    public const MIME_TYPES = [
        'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/ogg', 'audio/webm',
        'audio/aac', 'audio/mp4', 'audio/x-m4a',
    ];

    public const EXTENSIONS = ['mp3', 'wav', 'ogg', 'oga', 'opus', 'webm', 'aac', 'm4a'];

    protected $fillable = ['user_id', 'name', 'path', 'mime_type', 'size_bytes'];

    protected function casts(): array
    {
        return ['size_bytes' => 'integer'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function toneRef(): string
    {
        return self::PREFIX.$this->id;
    }
}
