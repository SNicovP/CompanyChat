<?php

namespace App\Jobs;

use App\Models\DeviceToken;
use App\Models\Message;
use App\Models\PushSubscription;
use App\Models\User;
use App\Support\Fcm;
use App\Support\Attachments;
use App\Support\PushMessage;
use App\Support\PushTargets;
use App\Support\Share;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\WebPush;

/**
 * Web Push for a new message (replaces the send-push Edge Function + Database Webhook).
 * Dispatched after the message is committed; runs on the queue.
 */
class SendMessagePush implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public function __construct(public string $messageId) {}

    public function handle(): void
    {
        $config = config('services.webpush');
        $web = ! empty($config['public_key']) && ! empty($config['private_key']) && ! empty($config['subject']);
        $fcm = Fcm::configured();
        if (! $web && ! $fcm) {
            return; // push is not configured
        }

        $message = Message::with('channel', 'attachments')->find($this->messageId);
        if (! $message) {
            return; // deleted before we got here
        }

        $targets = PushTargets::for($message);
        if (! $targets) {
            return;
        }

        $names = User::query()->pluck('display_name', 'id');
        $nameOf = fn (string $id) => $names[$id] ?? 'Unknown';
        $sender = $message->user_id ? $nameOf($message->user_id) : 'Someone';
        $fallback = Share::summary($message->share) ?? Attachments::summary($message->attachments);
        $note = fn (string $userId, bool $preview) => PushMessage::build(
            $targets[$userId],
            $message->channel_id,
            $message->channel->kind->value,
            $message->channel->name,
            $sender,
            $message->body,
            $preview,
            $nameOf,
            $fallback,
        );

        if ($web) {
            $this->sendWeb($config, $targets, $note);
        }
        if ($fcm) {
            $this->sendFcm($targets, $note);
        }
    }

    private function sendFcm(array $targets, callable $note): void
    {
        $dead = [];
        foreach (DeviceToken::query()->whereIn('user_id', array_keys($targets))->get() as $device) {
            $result = Fcm::send($device->token, $note($device->user_id, $device->show_preview));
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

    private function sendWeb(array $config, array $targets, callable $note): void
    {
        $subs = PushSubscription::query()->whereIn('user_id', array_keys($targets))->get();
        if ($subs->isEmpty()) {
            return;
        }

        $webPush = new WebPush(['VAPID' => [
            'subject' => $config['subject'],
            'publicKey' => $config['public_key'],
            'privateKey' => $config['private_key'],
        ]], ['TTL' => 3600, 'urgency' => 'high']);

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
