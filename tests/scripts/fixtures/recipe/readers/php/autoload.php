<?php

declare(strict_types=1);

// The fixture's stand-in for an autoloader: it loads the classes of the fixture in the order of their dependencies.
// A file that the tree does not hold is left out, so that the reader reports the class that it does not find.
foreach (['Widget', 'Labelled', 'Gadget', 'Derived', 'Helpers', 'Sealed', 'Tagged', 'Receivers'] as $name) {
    $file = __DIR__ . '/src/' . $name . '.php';
    if (is_file($file)) {
        require_once $file;
    }
}
