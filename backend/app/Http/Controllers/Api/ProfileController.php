<?php

namespace App\Http\Controllers\Api;

use App\Enums\UserStatus;
use App\Events\ProfileUpdated;
use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use App\Models\CustomSound;
use App\Support\Realtime;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Illuminate\Validation\Rules\Password as PasswordRule;

/** The signed-in person's own profile. */
class ProfileController extends Controller
{
    /** Kinds of message that can each have their own notification tone, and the incoming-call ringtone. */
    private const TONE_KINDS = ['dm', 'mention', 'channel', 'call'];

    public function show(Request $request): UserResource
    {
        return (new UserResource($request->user()))->withSettings();
    }

    /** Name, avatar, status and notification tones; the role is never self-editable. */
    public function update(Request $request): UserResource
    {
        $data = $request->validate([
            'display_name' => ['sometimes', 'string', 'min:1', 'max:80'],
            'avatar_url' => ['sometimes', 'nullable', 'url', 'max:255'],
            'status' => ['sometimes', Rule::enum(UserStatus::class)],
            // Built-in tone ids are the app's (app/utils/tones.ts; an id it no longer knows falls back to its default
            // there), or "custom:{id}" for one of your own uploaded sounds.
            'notification_tones' => ['sometimes', 'nullable', 'array:'.implode(',', self::TONE_KINDS)],
            'notification_tones.*' => ['string', 'max:64', function (string $attribute, mixed $value, \Closure $fail) use ($request) {
                if (! is_string($value)) {
                    return;
                }
                if (str_starts_with($value, CustomSound::PREFIX)) {
                    $id = substr($value, strlen(CustomSound::PREFIX));
                    $mine = Str::isUuid($id) && CustomSound::query()->whereKey($id)->where('user_id', $request->user()->id)->exists();
                    if (! $mine) {
                        $fail('That sound no longer exists.');
                    }
                } elseif (! preg_match('/^[a-z0-9_-]{1,32}$/', $value)) {
                    $fail('Unknown tone.');
                }
            }],
        ]);
        if (isset($data['display_name'])) {
            $data['display_name'] = trim($data['display_name']);
        }

        $user = $request->user();
        $user->fill($data)->save();
        // Tones are private: only tell others when something they can see changed.
        if ($user->wasChanged(['display_name', 'avatar_url', 'status'])) {
            Realtime::send(new ProfileUpdated($user));
        }

        return (new UserResource($user))->withSettings();
    }

    /** Change your password while signed in (needs the current one). Other devices are signed out. */
    public function updatePassword(Request $request): JsonResponse
    {
        $data = $request->validate([
            'current_password' => ['required', 'string'],
            'password' => ['required', 'string', PasswordRule::min(8)],
        ]);

        $user = $request->user();
        // A stolen token must not be enough to take the account over.
        if (! $user->password || ! Hash::check($data['current_password'], $user->password)) {
            throw ValidationException::withMessages(['current_password' => 'Your current password is not correct.']);
        }
        $user->forceFill(['password' => $data['password'], 'joined_at' => $user->joined_at ?? now()])->save();

        $current = $user->currentAccessToken();
        $user->tokens()->when($current?->id ?? null, fn ($q, $id) => $q->where('id', '!=', $id))->delete();

        return response()->json(['ok' => true]);
    }
}
