<?php

namespace App\Support;

use Illuminate\Validation\Rule;

/**
 * Structured things a message can carry instead of (or as well as) text:
 *   location: { type, lat, lng, label? }
 *   contact:  { type, name, phone?, email?, org?, user_id? }   (user_id: a CompanyChat person)
 *   call:     { type, status, duration? }   written by the server when a call ends (see App\Support\Calls), never sent by apps
 */
class Share
{
    /** Validation rules for the "share" field of a new message. */
    public static function rules(): array
    {
        return [
            'share' => ['nullable', 'array'],
            'share.type' => ['required_with:share', Rule::in(['location', 'contact'])],
            'share.lat' => ['required_if:share.type,location', 'nullable', 'numeric', 'between:-90,90'],
            'share.lng' => ['required_if:share.type,location', 'nullable', 'numeric', 'between:-180,180'],
            'share.label' => ['nullable', 'string', 'max:200'],
            'share.name' => ['required_if:share.type,contact', 'nullable', 'string', 'max:120'],
            'share.phone' => ['nullable', 'string', 'max:40', 'regex:/^[0-9+()\-.\s]*$/'],
            'share.email' => ['nullable', 'email', 'max:190'],
            'share.org' => ['nullable', 'string', 'max:120'],
            'share.user_id' => ['nullable', 'uuid', Rule::exists('users', 'id')],
        ];
    }

    /** Only the fields that belong to the type, trimmed, with empty values left out. */
    public static function clean(?array $share): ?array
    {
        if (! $share || empty($share['type'])) {
            return null;
        }
        $str = fn (string $k) => isset($share[$k]) && trim((string) $share[$k]) !== '' ? trim((string) $share[$k]) : null;

        $clean = $share['type'] === 'location'
            ? ['type' => 'location', 'lat' => round((float) $share['lat'], 6), 'lng' => round((float) $share['lng'], 6), 'label' => $str('label')]
            : ['type' => 'contact', 'name' => $str('name'), 'phone' => $str('phone'), 'email' => $str('email'), 'org' => $str('org'), 'user_id' => $str('user_id')];

        return array_filter($clean, fn ($v) => $v !== null);
    }

    /** One line describing the share, for notifications and quotes. */
    public static function summary(?array $share): ?string
    {
        return match ($share['type'] ?? null) {
            'location' => '📍 '.($share['label'] ?? 'Location'),
            'contact' => '👤 '.($share['name'] ?? 'Contact'),
            'call' => match ($share['status'] ?? null) {
                'ended' => '📞 Voice call',
                'missed', 'cancelled' => '📞 Missed call',
                'rejected' => '📞 Declined call',
                default => '📞 Call failed',
            },
            default => null,
        };
    }
}
