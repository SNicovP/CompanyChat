<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Rooms: group calls in a project channel (everyone talks, up to Room::MAX_CALL people) and announcements (one
 * speaker, everyone in the audience who is online listens). The audio goes device to device over WebRTC, set up with
 * whispers on presence-room.{id}; the server keeps who is in the room.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rooms', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('kind', 12); // call | announcement
            // the project channel; null for an announcement to everyone
            $table->foreignUuid('channel_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignUuid('started_by')->constrained('users')->cascadeOnDelete();
            $table->string('status', 8)->default('live'); // live | ended
            $table->timestamp('ended_at')->nullable();
            $table->timestamps();
            $table->index(['channel_id', 'status']);
            $table->index(['kind', 'status']);
        });

        Schema::create('room_participants', function (Blueprint $table) {
            $table->foreignUuid('room_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
            $table->string('role', 10); // member (call) | speaker | listener (announcement)
            $table->timestamp('joined_at');
            $table->timestamp('left_at')->nullable();
            $table->timestamp('last_seen_at'); // heartbeat
            $table->primary(['room_id', 'user_id']);
            $table->index('user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('room_participants');
        Schema::dropIfExists('rooms');
    }
};
