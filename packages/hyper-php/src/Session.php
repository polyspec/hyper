<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/** Owns the CSRF token and the flash data of one session (HY-16, HY-17). */
final class Session
{
    private const TOKEN = '_hyper_csrf';
    private const FLASH = '_hyper_flash';
    private const KEEP = '_hyper_keep';

    public function __construct(private readonly SessionStore $store)
    {
    }

    /** Returns the CSRF token and creates it on first use. */
    public function csrfToken(): string
    {
        $token = $this->store->get(self::TOKEN);
        if (!is_string($token) || $token === '') {
            $token = bin2hex(random_bytes(32));
            $this->store->set(self::TOKEN, $token);
        }

        return $token;
    }

    /** Returns the stored flash data and removes it from the session. */
    public function takeFlash(): Flash
    {
        $flash = $this->store->get(self::FLASH);
        $this->store->remove(self::FLASH);
        if (!is_array($flash)) {
            return new Flash([], []);
        }

        return new Flash($flash['values'] ?? [], $flash['changed'] ?? []);
    }

    /** Stores a kept value of a region (HY-39, HY-40). */
    public function keep(string $region, string $path, mixed $value): void
    {
        $kept = $this->store->get(self::KEEP);
        $kept = is_array($kept) ? $kept : [];
        $kept[$region][$path] = $value;
        $this->store->set(self::KEEP, $kept);
    }

    /**
     * Returns the kept values of a region in storing order.
     *
     * @return array<string, mixed>
     */
    public function kept(string $region): array
    {
        $kept = $this->store->get(self::KEEP);

        return is_array($kept) && is_array($kept[$region] ?? null) ? $kept[$region] : [];
    }

    /** Stores flash data for the next request. */
    public function putFlash(Flash $flash): void
    {
        $this->store->set(self::FLASH, ['values' => $flash->values, 'changed' => $flash->changed]);
    }
}
