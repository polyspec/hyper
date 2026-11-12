<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server\Tests\Steps;

use Polyspec\Hyper\Server\MediaType;

final class EssenceReader
{
    public function read(string $text): string
    {
        return MediaType::parse($text)->essence();
    }
}
