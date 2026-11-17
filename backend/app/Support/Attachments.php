<?php

namespace App\Support;

use App\Models\MessageAttachment;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;

class Attachments
{
    /** Signed URLs live as long as Supabase's did. */
    public const URL_TTL_SECONDS = 6 * 60 * 60;

    public static function disk(): Filesystem
    {
        return Storage::disk(config('filesystems.attachments_disk'));
    }

    public const MAX_FILES_PER_MESSAGE = 5;

    /** Storage-safe file name: letters, digits, dot, dash, underscore (same as the app's utils/files.ts). */
    public static function safeFileName(string $name): string
    {
        $clean = preg_replace('/^\.+/', '', preg_replace('/[^\w.-]+/', '_', $name));

        return substr($clean ?: 'file', -100);
    }

    /** Browsers render these safely inline; everything else is served as a download. */
    public static function isInlineImage(?string $mime): bool
    {
        return in_array($mime, ['image/png', 'image/jpeg', 'image/gif', 'image/webp'], true);
    }

    /** The type the browser reported, or (when it did not know) one guessed from the content. */
    public static function mimeOf(UploadedFile $file): ?string
    {
        $client = $file->getClientMimeType();
        if ($client && $client !== 'application/octet-stream') {
            return strtolower(explode(';', $client)[0]); // "audio/webm;codecs=opus" -> "audio/webm"
        }

        return $file->getMimeType() ?: null;
    }

    /** Audio and video the app plays in its own players (voice notes, camera recordings). */
    public const INLINE_MEDIA = [
        'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/wav', 'audio/x-m4a',
        'video/mp4', 'video/webm', 'video/quicktime', 'video/ogg',
    ];

    public static function isInlineMedia(?string $mime): bool
    {
        return in_array($mime, self::INLINE_MEDIA, true);
    }

    /** Safe to show in the page rather than force a download. */
    public static function isInline(?string $mime): bool
    {
        return self::isInlineImage($mime) || self::isInlineMedia($mime);
    }

    /** One line for notifications and quotes when a message has files but no text. */
    public static function summary(iterable $attachments): ?string
    {
        $live = collect($attachments)->whereNull('deleted_at')->values();
        if ($live->isEmpty()) {
            return null;
        }
        $first = $live->first();
        $mime = (string) $first->mime_type;
        $label = match (true) {
            str_starts_with($mime, 'audio/') && str_starts_with($first->file_name, 'voice-note') => '🎤 Voice note',
            str_starts_with($mime, 'audio/') => '🎵 Audio',
            str_starts_with($mime, 'video/') => '🎥 Video',
            str_starts_with($mime, 'image/') => '📷 Photo',
            default => '📎 '.$first->file_name,
        };

        return $live->count() > 1 ? "{$label} +".($live->count() - 1) : $label;
    }

    /** A short-lived URL anyone holding it can open (so it works in <img src> without a token). */
    public static function signedUrl(MessageAttachment $a, ?bool $download = null): string
    {
        $download ??= ! self::isInline($a->mime_type);

        return URL::temporarySignedRoute(
            'attachments.file',
            now()->addSeconds(self::URL_TTL_SECONDS),
            ['attachment' => $a->id, 'download' => $download ? 1 : 0],
        );
    }
}
