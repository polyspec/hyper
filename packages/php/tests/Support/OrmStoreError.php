<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support;

/** An error of category store of the orm binding, which a case names by its class and its kind (HY-107.7). */
final class OrmStoreError extends \RuntimeException
{
    public readonly ?int $status;

    public function __construct(public readonly string $kind)
    {
        parent::__construct($kind . ': a failure of the ORM');
        $this->status = null;
    }

    /** Returns the error of the orm binding that a case throws by its class and its kind, and fails for another class. */
    public static function thrown(mixed $thrown, string $what): OrmValueError|self
    {
        $thrown = Json::map($thrown, "the member throw of {$what}");
        $kind = $thrown['kind'] ?? null;
        if (!is_string($kind)) {
            throw new \UnexpectedValueException("{$what} throws an error of the ORM without a kind");
        }

        return match ($thrown['class'] ?? null) {
            'OrmValueError' => new OrmValueError($kind),
            'OrmStoreError' => new self($kind),
            default => throw new \UnexpectedValueException("{$what} throws a class other than an error of the ORM"),
        };
    }
}
