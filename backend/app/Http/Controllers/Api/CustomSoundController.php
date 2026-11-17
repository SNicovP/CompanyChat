<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\CustomSound;
use App\Support\Attachments;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;

/** Your own uploaded sounds, for notification tones and the ringtone. Nobody else can see or play them. */
class CustomSoundController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $sounds = CustomSound::query()->where('user_id', $request->user()->id)->orderBy('created_at')->get();

        return response()->json(['sounds' => $sounds->map(fn (CustomSound $s) => $this->present($s))->values()]);
    }

    /** multipart: file (audio, ≤ 1 MB), name (optional; defaults to the file name). */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'file' => ['required', 'file', 'max:'.CustomSound::MAX_KB],
            'name' => ['nullable', 'string', 'max:60'],
        ]);
        $user = $request->user();
        $file = $data['file'];

        $mime = Attachments::mimeOf($file);
        $ext = strtolower($file->getClientOriginalExtension());
        // What the content really is: audio, or a container/unknown binary (some MP3s have no recognisable header).
        $sniffed = (string) $file->getMimeType();
        $looksLikeAudio = preg_match('#^(audio/|video/(mp4|webm|ogg)$|application/(ogg|octet-stream)$)#', $sniffed) === 1;
        if (! in_array($mime, CustomSound::MIME_TYPES, true) || ! in_array($ext, CustomSound::EXTENSIONS, true) || ! $looksLikeAudio) {
            throw ValidationException::withMessages(['file' => 'Upload an MP3, WAV, OGG, M4A, AAC or WebM audio file.']);
        }
        if (CustomSound::query()->where('user_id', $user->id)->count() >= CustomSound::MAX_PER_USER) {
            throw ValidationException::withMessages(['file' => 'You can keep up to '.CustomSound::MAX_PER_USER.' sounds. Delete one first.']);
        }

        $name = trim((string) ($data['name'] ?? '')) ?: Str::limit(pathinfo($file->getClientOriginalName(), PATHINFO_FILENAME), 60, '');
        $id = (string) Str::uuid();
        $path = "sounds/{$user->id}/{$id}.{$ext}";
        Attachments::disk()->putFileAs("sounds/{$user->id}", $file, "{$id}.{$ext}");

        $sound = (new CustomSound)->forceFill([
            'id' => $id, // the same id as the file name
            'user_id' => $user->id,
            'name' => $name !== '' ? $name : 'My sound',
            'path' => $path,
            'mime_type' => $mime === 'audio/mp3' ? 'audio/mpeg' : $mime,
            'size_bytes' => $file->getSize(),
        ]);
        $sound->save();

        return response()->json(['sound' => $this->present($sound)], 201);
    }

    /** The audio itself (fetched once per device and kept in memory). */
    public function file(Request $request, CustomSound $sound): Response
    {
        abort_unless($sound->user_id === $request->user()->id, 404);
        $disk = Attachments::disk();
        abort_unless($disk->exists($sound->path), 404);

        return $disk->download($sound->path, Attachments::safeFileName($sound->name).'.'.pathinfo($sound->path, PATHINFO_EXTENSION), [
            'Content-Type' => $sound->mime_type,
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'private, max-age=86400',
        ]);
    }

    /** Delete a sound; anything that used it goes back to the default tone. */
    public function destroy(Request $request, CustomSound $sound): JsonResponse
    {
        $user = $request->user();
        abort_unless($sound->user_id === $user->id, 404);

        Attachments::disk()->delete($sound->path);
        $sound->delete();

        $tones = $user->notification_tones;
        if (is_array($tones)) {
            $kept = array_filter($tones, fn ($ref) => $ref !== $sound->toneRef());
            if (count($kept) !== count($tones)) {
                $user->forceFill(['notification_tones' => $kept ?: null])->save();
            }
        }

        return response()->json(['ok' => true, 'notification_tones' => $user->notification_tones]);
    }

    private function present(CustomSound $s): array
    {
        return ['id' => $s->id, 'name' => $s->name, 'mime_type' => $s->mime_type, 'size_bytes' => $s->size_bytes];
    }
}
