<?php

namespace App\Support;

use App\Models\DeviceToken;
use App\Models\PushSubscription;
use Illuminate\Support\Facades\Log;
use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\WebPush;

/**
 * Delivers a push notification to every browser (Web Push) and Android device (FCM) of the given people,
 * forgetting subscriptions and tokens the push services say are dead.
 */
class PushSender
{
    /** Is any push channel configured? */
    public static function configured(): bool
    {
        return self::webConfig() !== null || Fcm::configured();
    }

    /**
     * @param  string[]  $userIds
     * @param  callable(string $userId, bool $showPreview): array{title: string, body: string, tag: string, url: string}  $note
     * @param  int  $ttl  seconds the push service keeps trying to deliver it
     */
    public static function send(array $userIds, callable $note, int $ttl = 3600): void
    {
        if (! $userIds) {
            return;
        }
        if ($config = self::webConfig()) {
            self::sendWeb($config, $userIds, $note, $ttl);
        }
        if (Fcm::configured()) {
            self::sendFcm($userIds, $note, $ttl);
        }
    }

    private static function webConfig(): ?array
    {
        $config = config('services.webpush');

        return ! empty($config['public_key']) && ! empty($config['private_key']) && ! empty($config['subject']) ? $config : null;
    }

    private static function sendFcm(array $userIds, callable $note, int $ttl): void
    {
        $dead = [];
        foreach (DeviceToken::query()->whereIn('user_id', $userIds)->get() as $device) {
            $result = Fcm::send($device->token, $note($device->user_id, $device->show_preview), $ttl);
            if ($result === 'invalid') {
                $dead[] = $device->token_hash; // app uninstalled or token rotated: forget it
            } elseif ($result === 'error') {
                Log::warning('fcm push failed', ['device' => $device->id]);
            }
        }
        if ($dead) {
            DeviceToken::query()->whereIn('token_hash', $dead)->delete();
        }
    }

    private static function sendWeb(array $config, array $userIds, callable $note, int $ttl): void
    {
        $subs = PushSubscription::query()->whereIn('user_id', $userIds)->get();
        if ($subs->isEmpty()) {
            return;
        }

        $webPush = new WebPush(['VAPID' => [
            'subject' => $config['subject'],
            'publicKey' => $config['public_key'],
            'privateKey' => $config['private_key'],
        ]], ['TTL' => $ttl, 'urgency' => 'high']);

        foreach ($subs as $sub) {
            $webPush->queueNotification(
                Subscription::create(['endpoint' => $sub->endpoint, 'keys' => ['p256dh' => $sub->p256dh, 'auth' => $sub->auth]]),
                json_encode($note($sub->user_id, $sub->show_preview)),
            );
        }

        $expired = [];
        foreach ($webPush->flush() as $report) {
            if ($report->isSuccess()) {
                continue;
            }
            if ($report->isSubscriptionExpired()) {
                $expired[] = PushSubscription::hashEndpoint($report->getEndpoint()); // browser unsubscribed: forget it
            } else {
                Log::warning('push failed', ['reason' => $report->getReason()]);
            }
        }
        if ($expired) {
            PushSubscription::query()->whereIn('endpoint_hash', $expired)->delete();
        }
    }
}
