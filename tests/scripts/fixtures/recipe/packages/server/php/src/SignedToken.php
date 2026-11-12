<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server;

/**
 * The signed token of a JSON text of HY-2.
 *
 * @internal
 */
final class SignedToken extends Token
{
    public function __construct()
    {
        parent::__construct();
    }

    public static function all(): array
    {
        return [new SignedToken()];
    }

    public function shape(): string
    {
        return $this->sign();
    }

    private function sign(): string
    {
        return 'y';
    }
}
