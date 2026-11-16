<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DeviceToken extends Model
{
    use HasUuids;

    protected $fillable = ['user_id', 'token', 'token_hash', 'platform', 'show_preview'];

    protected $hidden = ['token', 'token_hash'];

    protected function casts(): array
    {
        return ['show_preview' => 'boolean'];
    }

    public static function hash(string $token): string
    {
        return hash('sha256', $token);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
