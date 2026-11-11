<?php

declare(strict_types=1);

// The fixture's stand-in for the server's Composer autoloader: Polyspec\Hyper\ maps to packages/server/php/src.
spl_autoload_register(static function (string $class): void {
    $prefix = 'Polyspec\\Hyper\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }
    $file = __DIR__ . '/../packages/server/php/src/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
    if (is_file($file)) {
        require $file;
    }
});
