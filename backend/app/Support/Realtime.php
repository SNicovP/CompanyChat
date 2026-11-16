<?php

namespace App\Support;

use Illuminate\Support\Facades\Broadcast;

/**
 * Sends a broadcast to Reverb without ever failing the request: the change is already saved, and
 * clients catch up on reconnect/refetch. Failures are reported to the log.
 */
class Realtime
{
    /** @param  bool  $toOthers  skip the socket that made the request (X-Socket-ID header) */
    public static function send(object $event, bool $toOthers = true): void
    {
        rescue(function () use ($event, $toOthers) {
            $pending = broadcast($event);
            if ($toOthers) {
                $pending->toOthers();
            }
            unset($pending); // dispatches now, inside rescue()
        }, report: true);
    }

    /**
     * Drops every open websocket of these users. Channel access is only checked when a client subscribes, so after
     * a deactivation, a removal from a project or an archive the open sockets must be closed; the client reconnects,
     * re-authorises its channels, and is refused whatever it may no longer see. Needs clients to have signed in
     * (POST /api/broadcasting/user-auth), which the app does on connect.
     */
    public static function disconnect(string ...$userIds): void
    {
        foreach (array_unique($userIds) as $id) {
            rescue(function () use ($id) {
                $broadcaster = Broadcast::connection();
                if (method_exists($broadcaster, 'getPusher')) {
                    $broadcaster->getPusher()->terminateUserConnections($id);
                }
            }, report: true);
        }
    }
}
