<?php

declare(strict_types=1);

namespace Fixture\Readers;

/** The forms of a PHP signature that differ between PHP releases (HYR-8): set visibilities, `self` and `parent`. */
class Shaped extends Widget
{
    public function __construct(
        public readonly string $name,
        public private(set) readonly string $code,
        public protected(set) string $label,
    ) {
    }

    public static function make(self $other, ?Shaped $copy): ?self
    {
        return $copy ?? $other;
    }

    public function base(): parent
    {
        return $this;
    }
}
