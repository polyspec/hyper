<?php

declare(strict_types=1);

// The fixture's stand-in for the server's Composer autoloader: it loads the stand-in for PHPUnit's base test class, the
// classes of packages/php/src and the case reader units of the test tree, each after the classes that it names.
// A file that the tree does not hold is left out, so that the reader reports the class that it does not find.
$files = [
    __DIR__ . '/phpunit-stub.php',
    __DIR__ . '/../packages/php/src/SessionStore.php',
    __DIR__ . '/../packages/php/src/ArraySession.php',
    __DIR__ . '/../packages/php/src/Csrf.php',
    __DIR__ . '/../packages/php/src/Token.php',
    __DIR__ . '/../packages/php/src/SignedToken.php',
    __DIR__ . '/../packages/php/src/JsonCodec.php',
    __DIR__ . '/../packages/php/src/MediaType.php',
    __DIR__ . '/../packages/php/tests/CaseReader.php',
    __DIR__ . '/../packages/php/tests/CaseRunnerTest.php',
    __DIR__ . '/../packages/php/tests/CaseSteps.php',
    __DIR__ . '/../packages/php/tests/Steps/CsrfSteps.php',
    __DIR__ . '/../packages/php/tests/Steps/EssenceReader.php',
    __DIR__ . '/../packages/php/tests/Steps/MediaTypeSteps.php',
];
foreach ($files as $file) {
    if (is_file($file)) {
        require_once $file;
    }
}
