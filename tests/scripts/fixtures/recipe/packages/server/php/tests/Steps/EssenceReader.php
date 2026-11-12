<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Steps;

use Polyspec\Hyper\MediaType;

final class EssenceReader
{
    public function read(string $text): string
    {
        return MediaType::parse($text)->essence();
    }
}
