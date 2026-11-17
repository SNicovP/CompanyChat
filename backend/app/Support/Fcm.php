<?php

namespace App\Support;

use Google\Auth\Credentials\ServiceAccountCredentials;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

/** Sends Firebase Cloud Messaging (HTTP v1) notifications to the Android app. */
class Fcm
{
    public static function configured(): bool
    {
        return (bool) self::credentials();
    }

    /** The service-account JSON, from FCM_CREDENTIALS (a file path). */
    private static function credentials(): ?array
    {
        $path = config('services.fcm.credentials');
        if (! $path || ! is_file($path)) {
            return null;
        }

        return json_decode(file_get_contents($path), true) ?: null;
    }

    private static function accessToken(array $credentials): string
    {
        return Cache::remember('fcm:access-token', 3000, function () use ($credentials) {
            $auth = new ServiceAccountCredentials('https://www.googleapis.com/auth/firebase.messaging', $credentials);

            return $auth->fetchAuthToken()['access_token'];
        });
    }

    /**
     * @param  array{title: string, body: string, tag: string, url: string}  $note
     * @param  ?int  $ttl  seconds FCM keeps trying to deliver it (default: FCM's four weeks)
     * @return 'ok'|'invalid'|'error'  invalid = the token is dead and should be forgotten
     */
    public static function send(string $token, array $note, ?int $ttl = null): string
    {
        $credentials = self::credentials();
        if (! $credentials) {
            return 'error';
        }

        $response = Http::withToken(self::accessToken($credentials))
            ->post("https://fcm.googleapis.com/v1/projects/{$credentials['project_id']}/messages:send", [
                'message' => [
                    'token' => $token,
                    'notification' => ['title' => $note['title'], 'body' => $note['body']],
                    'data' => ['url' => $note['url']],
                    'android' => array_filter([
                        'priority' => 'HIGH',
                        'ttl' => $ttl ? "{$ttl}s" : null,
                        'notification' => ['tag' => $note['tag'], 'channel_id' => 'messages'],
                    ]),
                ],
            ]);

        if ($response->successful()) {
            return 'ok';
        }
        $status = $response->json('error.status');

        return in_array($status, ['NOT_FOUND', 'UNREGISTERED', 'INVALID_ARGUMENT'], true) ? 'invalid' : 'error';
    }
}
