<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * Owns the CSRF token, the flash data and the kept values of one session (HY-24, HY-25, HY-40).
 *
 * @internal
 */
final class Session
{
    private const TOKEN = '_hyper_csrf';
    private const FLASH = '_hyper_flash';
    private const KEEP = '_hyper_keep';

    public function __construct(private readonly SessionStore $store)
    {
    }

    /** Returns the CSRF token, 64 lowercase hexadecimal digits, and creates it on first use or over another value (HY-24). */
    public function csrfToken(): string
    {
        $token = $this->store->get(self::TOKEN);
        if (!is_string($token) || preg_match('/^[0-9a-f]{64}$/D', $token) !== 1) {
            $token = bin2hex(random_bytes(32));
            $this->store->set(self::TOKEN, $token);
        }

        return $token;
    }

    /** Moves the session to a new identifier and replaces its token (HY-72). */
    public function renew(): void
    {
        $this->store->renew();
        $this->store->set(self::TOKEN, bin2hex(random_bytes(32)));
    }

    /**
     * Returns the stored flash data and removes it from the session. rules.flash_of of the core checks the stored
     * flash first and fails with `invalid_session_record` for one of another form (HY-25.2, HY-104.23).
     */
    public function takeFlash(): Flash
    {
        $stored = $this->store->get(self::FLASH);
        if ($stored === null) {
            return new Flash([], []);
        }
        $flash = self::coreMap(CoreRules::shared()->sessionFlashOf($stored));
        $this->store->remove(self::FLASH);
        /** @var list<string> $changed rules.flash_of gives a list of strings (HY-104.22). */
        $changed = $flash['changed'] ?? [];

        return new Flash(self::coreMap($flash['values'] ?? []), $changed);
    }

    /** Stores a kept value of a region (HY-38, HY-40). */
    public function keep(string $region, string $path, mixed $value): void
    {
        // HY-40.4: a kept value is a value of the data model, checked before anything is stored.
        DataModel::check($value);
        // HY-104.23: the kept values of every region are a map, also those of another region than this one.
        $kept = $this->storedKept();
        $regionKept = array_key_exists($region, $kept) ? self::coreMap($kept[$region]) : [];
        $regionKept[$path] = $value;
        $kept[$region] = $regionKept;
        $this->store->set(self::KEEP, $kept);
    }

    /**
     * Returns the kept values of a region by path in storing order.
     *
     * @return array<array-key, mixed>
     */
    public function kept(string $region): array
    {
        $kept = $this->storedKept();

        return array_key_exists($region, $kept) ? self::coreMap($kept[$region]) : [];
    }

    /**
     * The stored kept values by region, which rules.kept_of of the core checks, those of every region, and which
     * fails with `invalid_session_record` for kept values of another form (HY-104.22, HY-104.23).
     *
     * @return array<array-key, mixed>
     */
    private function storedKept(): array
    {
        $stored = $this->store->get(self::KEEP);

        return $stored === null ? [] : self::coreMap(CoreRules::shared()->sessionKeptOf($stored));
    }

    /**
     * Returns the entries of a map that the core gives, a `stdClass` or an empty array.
     *
     * @return array<array-key, mixed>
     */
    private static function coreMap(mixed $value): array
    {
        if ($value instanceof \stdClass) {
            return get_object_vars($value);
        }

        return is_array($value) ? $value : [];
    }

    /** Stores flash data for the next request. */
    public function putFlash(Flash $flash): void
    {
        $this->store->set(self::FLASH, ['values' => $flash->values, 'changed' => $flash->changed]);
    }
}
