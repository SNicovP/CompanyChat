<?php

namespace App\Jobs;

use App\Models\Call;
use App\Support\Calls;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/** Dispatched with a delay when a call starts: nobody answered in time, so it becomes a missed call. */
class ExpireCall implements ShouldQueue
{
    use Queueable;

    public function __construct(public string $callId) {}

    public function handle(): void
    {
        $call = Call::query()->find($this->callId);
        // a queue without delays (sync) runs this straight away; expireIfStale leaves a call that is still in time alone
        if ($call && $call->status === Call::RINGING) {
            Calls::expireIfStale($call);
        }
    }
}
