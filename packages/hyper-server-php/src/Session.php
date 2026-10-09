<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/** Owns the CSRF token, the flash data and the kept values of one session (HY-24, HY-25, HY-40). */
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

    /** Returns the stored flash data and removes it from the session. */
    public function takeFlash(): Flash
    {
        $flash = $this->store->get(self::FLASH);
        $this->store->remove(self::FLASH);
        if (!is_array($flash)) {
            return new Flash([], []);
        }

        $values = $flash['values'] ?? [];
        $changed = $flash['changed'] ?? [];
        if (!is_array($values) || !is_array($changed) || !array_is_list($changed)) {
            throw new \UnexpectedValueException('the session holds flash data that is not values and a list of topics');
        }
        $topics = [];
        foreach ($changed as $topic) {
            if (!is_string($topic)) {
                throw new \UnexpectedValueException('the session holds a changed topic that is not a string');
            }
            $topics[] = $topic;
        }

        return new Flash($values, $topics);
    }

    /** Stores a kept value of a region (HY-39, HY-40). */
    public function keep(string $region, string $path, mixed $value): void
    {
        $kept = $this->store->get(self::KEEP);
        $kept = is_array($kept) ? $kept : [];
        $regionKept = is_array($kept[$region] ?? null) ? $kept[$region] : [];
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
        $kept = $this->store->get(self::KEEP);

        return is_array($kept) && is_array($kept[$region] ?? null) ? $kept[$region] : [];
    }

    /** Stores flash data for the next request. */
    public function putFlash(Flash $flash): void
    {
        $this->store->set(self::FLASH, ['values' => $flash->values, 'changed' => $flash->changed]);
    }
}
