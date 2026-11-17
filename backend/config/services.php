<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Resend, Postmark, AWS, and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    // Web Push (VAPID). Generate keys with: php artisan chat:vapid-keys
    'webpush' => [
        'public_key' => env('VAPID_PUBLIC_KEY'),
        'private_key' => env('VAPID_PRIVATE_KEY'),
        'subject' => env('VAPID_SUBJECT'), // mailto:you@yourcompany.com
    ],

    // Voice calls (WebRTC). STUN lets two devices behind ordinary NAT find each other; calls between networks that
    // block direct connections (carrier NAT, strict firewalls) are relayed by coturn.
    'webrtc' => [
        'stun_urls' => array_values(array_filter(array_map('trim', explode(',', (string) env('WEBRTC_STUN_URLS', 'stun:stun.l.google.com:19302,stun:stun.cloudflare.com:3478'))))),
    ],

    // coturn with use-auth-secret: the API turns the shared secret into short-lived credentials per user (see App\Support\Calls).
    'coturn' => [
        'urls' => array_values(array_filter(array_map('trim', explode(',', (string) env('COTURN_URLS', ''))))),
        'secret' => env('COTURN_SECRET'),
        'ttl' => (int) env('COTURN_TTL', 86400),
    ],

    // Firebase Cloud Messaging for the Android app: path to the service-account JSON (Firebase console > Service accounts).
    'fcm' => [
        'credentials' => env('FCM_CREDENTIALS'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

];
