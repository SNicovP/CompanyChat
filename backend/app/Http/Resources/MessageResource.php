<?php

namespace App\Http\Resources;

use App\Models\Message;
use App\Support\Attachments;
use App\Support\Share;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Message */
class MessageResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'channel_id' => $this->channel_id,
            'user_id' => $this->user_id,
            'body' => $this->body,
            'share' => $this->share,
            'reply_to' => $this->reply_to,
            // enough of the original to show a quote, even when it is older than the page the app has loaded
            'reply_preview' => $this->reply_to && $this->replyTo ? [
                'user_id' => $this->replyTo->user_id,
                'body' => $this->replyTo->body,
                'has_files' => $this->replyTo->attachments->whereNull('deleted_at')->isNotEmpty(),
                // what to show when the quoted message has no text ("🎤 Voice note", "📍 Location", ...)
                'summary' => Share::summary($this->replyTo->share) ?? Attachments::summary($this->replyTo->attachments),
            ] : null,
            // UTC with microseconds and a Z, like the browser's toISOString(), so the app can sort by string
            'created_at' => $this->created_at?->copy()->utc()->format('Y-m-d\TH:i:s.u\Z'),
            'edited_at' => $this->edited_at?->toISOString(),
            // same key the Supabase select used, so the frontend types barely change
            'message_attachments' => AttachmentResource::collection($this->whenLoaded('attachments')),
        ];
    }
}
