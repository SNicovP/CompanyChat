<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Blocking is not private: both people can see it (the blocked person is told when they try to write or call).
        Schema::create('user_blocks', function (Blueprint $table) {
            $table->foreignUuid('blocker_id')->constrained('users')->cascadeOnDelete();
            $table->foreignUuid('blocked_id')->constrained('users')->cascadeOnDelete();
            $table->timestamp('created_at')->useCurrent();
            $table->primary(['blocker_id', 'blocked_id']);
            $table->index('blocked_id');
        });

        // Intercom: an announcement heard by one person.
        Schema::table('rooms', function (Blueprint $table) {
            $table->foreignUuid('target_user_id')->nullable()->after('channel_id')->constrained('users')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('rooms', function (Blueprint $table) {
            $table->dropConstrainedForeignId('target_user_id');
        });
        Schema::dropIfExists('user_blocks');
    }
};
