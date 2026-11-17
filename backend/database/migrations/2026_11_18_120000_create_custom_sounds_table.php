<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Sounds people upload to use as a notification tone or ringtone. Private to their owner; the files live on the
 * attachments disk under sounds/{user}/. Referenced from users.notification_tones as "custom:{id}".
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('custom_sounds', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
            $table->string('name', 60);
            $table->string('path', 500)->unique();
            $table->string('mime_type');
            $table->unsignedInteger('size_bytes');
            $table->timestamps();
            $table->index('user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('custom_sounds');
    }
};
