<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The person's notification tone per kind of message, e.g. {"dm": "chime", "mention": "alert", "channel": "classic"}.
 * Null until they change one; the app then uses its defaults. Only ever returned to the person themself.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->json('notification_tones')->nullable()->after('status');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('notification_tones');
        });
    }
};
