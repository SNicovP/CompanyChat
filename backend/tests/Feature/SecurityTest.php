<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Support\Facades\RateLimiter;
use Tests\TestCase;

/** Hardening on top of the Supabase port: token lifetime, password change, login throttling. */
class SecurityTest extends TestCase
{
    private function login(User $user): string
    {
        return $this->postJson('/api/auth/login', ['email' => $user->email, 'password' => 'password'])->assertOk()->json('token');
    }

    public function test_changing_your_password_needs_the_current_one(): void
    {
        $user = User::factory()->create();
        $token = $this->login($user);

        $this->withToken($token)->putJson('/api/me/password', ['password' => 'brand-new-pass'])->assertStatus(422);
        $this->withToken($token)->putJson('/api/me/password', ['current_password' => 'wrong', 'password' => 'brand-new-pass'])
            ->assertStatus(422)->assertJsonValidationErrors('current_password');
        $this->withToken($token)->putJson('/api/me/password', ['current_password' => 'password', 'password' => 'brand-new-pass'])->assertOk();

        $this->postJson('/api/auth/login', ['email' => $user->email, 'password' => 'brand-new-pass'])->assertOk();
    }

    public function test_tokens_expire(): void
    {
        $user = User::factory()->create();
        $token = $this->login($user);
        $this->withToken($token)->getJson('/api/me')->assertOk();

        $this->travel(config('sanctum.expiration') + 1)->minutes();
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson('/api/me')->assertUnauthorized();
    }

    public function test_guessing_one_account_is_throttled_across_addresses(): void
    {
        RateLimiter::clear('auth:victim@example.com');
        User::factory()->create(['email' => 'victim@example.com']);

        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/auth/login', ['email' => 'victim@example.com', 'password' => 'nope'])->assertStatus(422);
        }
        $this->postJson('/api/auth/login', ['email' => 'victim@example.com', 'password' => 'password'])->assertStatus(429);
    }
}
