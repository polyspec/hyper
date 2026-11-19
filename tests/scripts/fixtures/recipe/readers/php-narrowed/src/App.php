<?php

declare(strict_types=1);

namespace Fixture\Readers;

/** The request step that answers an action whose result the container gives. */
final class App
{
    public function __construct(private object $container)
    {
    }

    public function routed(): int
    {
        $result = $this->container->call();
        if ($result instanceof Result && $result->isRedirect()) {
            return 303;
        }

        return 200;
    }
}
