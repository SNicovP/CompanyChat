<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A shared location or contact card on a message (see App\Support\Share). Null for ordinary messages.
 * Voice notes, photos and videos are ordinary attachments.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('messages', function (Blueprint $table) {
            $table->json('share')->nullable()->after('body');
        });
    }

    public function down(): void
    {
        Schema::table('messages', function (Blueprint $table) {
            $table->dropColumn('share');
        });
    }
};
