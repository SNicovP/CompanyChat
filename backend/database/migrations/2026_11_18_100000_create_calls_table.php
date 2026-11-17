<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 1:1 voice calls in a DM. The server only tracks who is calling whom and the call's state; the audio goes
 * peer to peer over WebRTC, set up with whispers on private-call.{id} (see App\Http\Controllers\Api\CallController).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('calls', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('channel_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('caller_id')->constrained('users')->cascadeOnDelete();
            $table->foreignUuid('callee_id')->constrained('users')->cascadeOnDelete();
            // ringing | active | ended | missed | rejected | cancelled | failed
            $table->string('status', 12)->default('ringing');
            $table->string('end_reason', 20)->nullable();
            $table->timestamp('answered_at')->nullable();
            $table->timestamp('ended_at')->nullable();
            $table->timestamps(); // updated_at doubles as the heartbeat of an active call
            $table->index(['caller_id', 'status']);
            $table->index(['callee_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('calls');
    }
};
