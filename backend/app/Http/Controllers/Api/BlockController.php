<?php

namespace App\Http\Controllers\Api;

use App\Events\BlockChanged;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Blocks;
use App\Support\Realtime;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Block and unblock people. Not private: the blocked person is told, and sees it in your DM. */
class BlockController extends Controller
{
    /** Whom I blocked, and who blocked me. */
    public function index(Request $request): JsonResponse
    {
        return response()->json(Blocks::of($request->user()));
    }

    public function store(Request $request, User $user): JsonResponse
    {
        $me = $request->user();
        abort_if($user->id === $me->id, 422, 'You cannot block yourself.');
        DB::table('user_blocks')->insertOrIgnore(['blocker_id' => $me->id, 'blocked_id' => $user->id, 'created_at' => now()]);
        Realtime::send(new BlockChanged($me->id, $user->id, true), toOthers: false);

        return response()->json(Blocks::of($me));
    }

    public function destroy(Request $request, User $user): JsonResponse
    {
        $me = $request->user();
        DB::table('user_blocks')->where(['blocker_id' => $me->id, 'blocked_id' => $user->id])->delete();
        Realtime::send(new BlockChanged($me->id, $user->id, false), toOthers: false);

        return response()->json(Blocks::of($me));
    }
}
