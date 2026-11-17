<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DeviceToken;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** FCM tokens of the native apps: one per installed app. A token moves to whoever signed in last. */
class DeviceTokenController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'token' => ['required', 'string', 'max:4096'],
            'platform' => ['nullable', 'in:android,ios'],
            'show_preview' => ['nullable', 'boolean'],
        ]);

        DeviceToken::query()->updateOrCreate(
            ['token_hash' => DeviceToken::hash($data['token'])],
            [
                'user_id' => $request->user()->id,
                'token' => $data['token'],
                'platform' => $data['platform'] ?? 'android',
                'show_preview' => $data['show_preview'] ?? true,
            ],
        );

        return response()->json(['ok' => true]);
    }

    public function update(Request $request): JsonResponse
    {
        $data = $request->validate(['token' => ['required', 'string'], 'show_preview' => ['required', 'boolean']]);
        $this->own($request, $data['token'])->update(['show_preview' => $data['show_preview']]);

        return response()->json(['ok' => true]);
    }

    public function destroy(Request $request): JsonResponse
    {
        $data = $request->validate(['token' => ['required', 'string']]);
        $this->own($request, $data['token'])->delete();

        return response()->json(['ok' => true]);
    }

    private function own(Request $request, string $token)
    {
        return DeviceToken::query()->where('user_id', $request->user()->id)->where('token_hash', DeviceToken::hash($token));
    }
}
