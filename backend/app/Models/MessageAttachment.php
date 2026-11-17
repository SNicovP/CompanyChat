<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A file on a message. Stored on the "attachments" disk at <channel_id>/<message_id>/<n>_<file name>.
 * Deleting a single attachment removes the file and sets deleted_at, so the chat can show a tag in its place.
 */
class MessageAttachment extends Model
{
    use HasUuids;

    public const MAX_BYTES = 10 * 1024 * 1024;

    /** Videos (and long recordings) may be bigger than other files. */
    public const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

    public static function maxBytesFor(?string $mime): int
    {
        return str_starts_with((string) $mime, 'video/') || str_starts_with((string) $mime, 'audio/') ? self::MAX_MEDIA_BYTES : self::MAX_BYTES;
    }

    protected $fillable = ['message_id', 'channel_id', 'path', 'file_name', 'mime_type', 'size_bytes'];

    protected $hidden = ['created_at', 'updated_at'];

    protected function casts(): array
    {
        return [
            'size_bytes' => 'integer',
            'deleted_at' => 'datetime',
        ];
    }

    public function message(): BelongsTo
    {
        return $this->belongsTo(Message::class);
    }

    public function channel(): BelongsTo
    {
        return $this->belongsTo(Channel::class);
    }
}
