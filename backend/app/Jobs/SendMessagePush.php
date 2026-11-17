<?php

namespace App\Jobs;

use App\Models\Message;
use App\Models\User;
use App\Support\Attachments;
use App\Support\PushMessage;
use App\Support\PushSender;
use App\Support\PushTargets;
use App\Support\Share;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

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
        if (! PushSender::configured()) {
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

        PushSender::send(array_keys($targets), fn (string $userId, bool $preview) => PushMessage::build(
            $targets[$userId],
            $message->channel_id,
            $message->channel->kind->value,
            $message->channel->name,
            $sender,
            $message->body,
            $preview,
            $nameOf,
            $fallback,
        ));
    }
}
