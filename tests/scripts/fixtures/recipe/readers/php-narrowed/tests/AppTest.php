<?php

declare(strict_types=1);

namespace Fixture\Readers;

final class AppTest
{
    public function testRoutedRedirects(): void
    {
        (new App(new \stdClass()))->routed();
    }
}
