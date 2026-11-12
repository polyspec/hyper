<?php

declare(strict_types=1);

// Reads the PHP server sources for the recipe check (HYR-8) and prints one JSON document on stdout.
// Usage: php read-php.php <root> --autoload <autoload.php> --sources <dir>... [--tests <dir>...] [--registry <file>]
// The autoloader of the server package loads each source class by its name; the reader never requires a file itself.
// Reflection is used for members, constants and visibility; signatures are rebuilt from reflection.
// The functions of the reader are in read-php-functions.php beside this file.

require __DIR__ . '/read-php-functions.php';
require __DIR__ . '/PhpScope.php';
require __DIR__ . '/read-php-scopes.php';

$args = array_slice($argv, 1);
if ($args === []) {
    fwrite(STDERR, "usage: read-php.php <root> --autoload <autoload.php> --sources <dir>... [--tests <dir>...]\n");
    exit(2);
}
$root = rtrim(array_shift($args), '/');
$groups = ['sources' => [], 'tests' => []];
$autoload = null;
$registry = null;
$current = null;
for ($i = 0; $i < count($args); $i++) {
    $arg = $args[$i];
    if ($arg === '--autoload') {
        $autoload = $args[++$i] ?? null;
        $current = null;
        continue;
    }
    if ($arg === '--registry') {
        $registry = $args[++$i] ?? null;
        $current = null;
        continue;
    }
    if ($arg === '--sources' || $arg === '--tests') {
        $current = substr($arg, 2);
        continue;
    }
    if ($current === null) {
        fwrite(STDERR, "argument before --autoload, --sources or --tests: $arg\n");
        exit(2);
    }
    $groups[$current][] = $arg;
}
if ($autoload === null || !is_file($autoload)) {
    fwrite(STDERR, "read-php.php: --autoload takes the autoloader file, got " . var_export($autoload, true) . "\n");
    exit(2);
}
require $autoload;

$sourceFiles = [];
foreach ($groups['sources'] as $dir) {
    $sourceFiles = array_merge($sourceFiles, phpFiles($root, $dir));
}
$testFiles = [];
foreach ($groups['tests'] as $dir) {
    $testFiles = array_merge($testFiles, phpFiles($root, $dir));
}

$out = [
    'language' => 'php',
    'files' => $sourceFiles,
    'units' => [],
    'types' => [],
    'members' => [],
    'constants' => [],
    'exports' => [],
    'uses' => [],
    'tests' => [],
    'dynamicTests' => [],
    // A private constructor is private by the language in PHP, so the reader records no calls (HYR-8).
    'calls' => [],
];

foreach ($sourceFiles as $file) {
    $path = $root . '/' . $file;
    foreach (declaredTypes(file_get_contents($path)) as $fqcn) {
        $class = loadClass($file, $path, $fqcn);
        $unit = $class->getShortName();
        $internal = docInternal($class->getDocComment());
        $out['units'][] = ['file' => $file, 'name' => $unit, 'kind' => unitKind($class), 'internal' => $internal];
        foreach (ownMethods($class) as $method) {
            $kind = match (true) {
                $method->getName() === '__construct' => 'constructor',
                $method->isStatic() => 'static method',
                default => 'method',
            };
            $out['members'][] = [
                'file' => $file,
                'unit' => $unit,
                'name' => $method->getName(),
                'kind' => $kind,
                'visibility' => visibility($method, $internal),
                'symbol' => "$file::$fqcn::{$method->getName()}",
                'signature' => methodSignature($method),
                'parameters' => array_map(static fn($p) => $p->getName(), $method->getParameters()),
            ];
        }
        foreach (ownProperties($class) as $property) {
            if (!$property->isPublic()) {
                continue;
            }
            $out['members'][] = [
                'file' => $file,
                'unit' => $unit,
                'name' => $property->getName(),
                'kind' => 'property',
                'visibility' => visibility($property, $internal),
                'symbol' => "$file::$fqcn::{$property->getName()}",
                'signature' => propertySignature($property),
                'parameters' => [],
            ];
        }
        foreach (ownConstants($class) as $constant) {
            $out['constants'][] = [
                'file' => $file,
                'unit' => $unit,
                'name' => $constant->getName(),
                'visibility' => visibility($constant, $internal),
            ];
        }
    }
}

foreach ($testFiles as $file) {
    foreach (testNames(file_get_contents($root . '/' . $file)) as $name) {
        $out['tests'][] = ['file' => $file, 'name' => $name];
    }
}

// HYR-5, HYR-7: the scopes of every file of the sources and of the test tree, and the registry of the steps.
$out += phpScopes($root, array_values(array_unique([...$sourceFiles, ...$testFiles])), $registry);

echo json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR), "\n";
