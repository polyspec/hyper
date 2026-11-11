<?php

declare(strict_types=1);

// Reads the PHP server sources for the recipe check (HYR-8) and prints one JSON document on stdout.
// Usage: php read-php.php <root> --autoload <autoload.php> --sources <dir>... [--tests <dir>...]
// The autoloader of the server package loads each source class by its name; the reader never requires a file itself.
// Reflection is used for members, constants and visibility; signatures are rebuilt from reflection.

$args = array_slice($argv, 1);
if ($args === []) {
    fwrite(STDERR, "usage: read-php.php <root> --autoload <autoload.php> --sources <dir>... [--tests <dir>...]\n");
    exit(2);
}
$root = rtrim(array_shift($args), '/');
$groups = ['sources' => [], 'tests' => []];
$autoload = null;
$current = null;
for ($i = 0; $i < count($args); $i++) {
    $arg = $args[$i];
    if ($arg === '--autoload') {
        $autoload = $args[++$i] ?? null;
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

/** @return list<string> the PHP files below a directory, relative to the root, sorted */
function phpFiles(string $root, string $dir): array
{
    $found = [];
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root . '/' . $dir, FilesystemIterator::SKIP_DOTS));
    foreach ($iterator as $file) {
        if ($file->getExtension() === 'php') {
            $found[] = substr($file->getPathname(), strlen($root) + 1);
        }
    }
    sort($found);

    return $found;
}

/** @return list<array> the tokens of a file without whitespace and comments */
function significant(string $code): array
{
    return array_values(array_filter(
        token_get_all($code),
        static fn($t) => !is_array($t) || !in_array($t[0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true),
    ));
}

/** @return bool true when the token before index $i is `new` or `::`, so the keyword names no declaration */
function isReference(array $tokens, int $i): bool
{
    $prev = $tokens[$i - 1] ?? null;

    return is_array($prev) && in_array($prev[0], [T_NEW, T_DOUBLE_COLON], true);
}

/** @return list<string> the fully qualified names of the classes, interfaces and traits declared in a file */
function declaredTypes(string $code): array
{
    $tokens = significant($code);
    $namespace = '';
    $types = [];
    foreach ($tokens as $i => $token) {
        if (!is_array($token)) {
            continue;
        }
        if ($token[0] === T_NAMESPACE) {
            $namespace = '';
            for ($j = $i + 1; $tokens[$j] !== ';' && $tokens[$j] !== '{'; $j++) {
                if (is_array($tokens[$j])) {
                    $namespace .= $tokens[$j][1];
                }
            }
        }
        if (in_array($token[0], [T_CLASS, T_INTERFACE, T_TRAIT], true) && !isReference($tokens, $i)) {
            $types[] = ($namespace === '' ? '' : $namespace . '\\') . $tokens[$i + 1][1];
        }
    }

    return $types;
}

/** @return list<string> the test methods of a test file, as Class::method */
function testNames(string $code): array
{
    $tokens = significant($code);
    $class = '';
    $names = [];
    foreach ($tokens as $i => $token) {
        if (!is_array($token)) {
            continue;
        }
        if ($token[0] === T_CLASS && !isReference($tokens, $i)) {
            $class = $tokens[$i + 1][1];
        }
        if ($token[0] === T_FUNCTION && is_array($tokens[$i + 1]) && str_starts_with($tokens[$i + 1][1], 'test')) {
            $names[] = $class . '::' . $tokens[$i + 1][1];
        }
    }

    return $names;
}

/** @return list<ReflectionMethod> the methods a class declares itself: a trait method has the trait's file */
function ownMethods(ReflectionClass $class): array
{
    return array_values(array_filter(
        $class->getMethods(),
        static fn(ReflectionMethod $m) => $m->getDeclaringClass()->getName() === $class->getName()
            && $m->getFileName() === $class->getFileName(),
    ));
}

/** @return list<ReflectionProperty> the properties a class declares itself, not the ones its traits declare */
function ownProperties(ReflectionClass $class): array
{
    return array_values(array_filter(
        $class->getProperties(),
        static fn(ReflectionProperty $p) => $p->getDeclaringClass()->getName() === $class->getName()
            && !declaredByTrait($class, $p->getName(), false),
    ));
}

/** @return list<ReflectionClassConstant> the constants a class declares itself, not the ones its traits declare */
function ownConstants(ReflectionClass $class): array
{
    return array_values(array_filter(
        $class->getReflectionConstants(),
        static fn(ReflectionClassConstant $c) => $c->getDeclaringClass()->getName() === $class->getName()
            && !declaredByTrait($class, $c->getName(), true),
    ));
}

/** Whether a trait of the class, or a trait of that trait, declares the property or the constant. */
function declaredByTrait(ReflectionClass $class, string $name, bool $constant): bool
{
    foreach ($class->getTraits() as $trait) {
        if ($constant ? $trait->hasConstant($name) : $trait->hasProperty($name)) {
            return true;
        }
        if (declaredByTrait($trait, $name, $constant)) {
            return true;
        }
    }
    return false;
}

function unitKind(ReflectionClass $class): string
{
    if ($class->isInterface()) {
        return 'interface';
    }
    if ($class->isTrait()) {
        return 'trait';
    }
    $methods = ownMethods($class);
    $functions = $methods !== []
        && ownProperties($class) === []
        && ownConstants($class) === []
        && !in_array('__construct', array_map(static fn($m) => $m->getName(), $methods), true);
    foreach ($methods as $method) {
        $functions = $functions && $method->isStatic();
    }

    return $functions ? 'functions' : 'class';
}

/** A member is internal when its own docblock or its class docblock has @internal; private and protected win. */
function visibility(ReflectionMethod|ReflectionProperty|ReflectionClassConstant $member, bool $classInternal): string
{
    if ($member->isPrivate()) {
        return 'private';
    }
    if ($member->isProtected()) {
        return 'protected';
    }
    $doc = $member->getDocComment();

    return $classInternal || ($doc !== false && str_contains($doc, '@internal')) ? 'internal' : 'public';
}

function methodSignature(ReflectionMethod $method): string
{
    $params = [];
    foreach ($method->getParameters() as $p) {
        $type = $p->getType() === null ? '' : $p->getType() . ' ';
        $params[] = $type . ($p->isPassedByReference() ? '&' : '') . ($p->isVariadic() ? '...' : '') . '$' . $p->getName();
    }
    $return = $method->getReturnType() === null ? '' : ': ' . $method->getReturnType();

    $modifiers = [...Reflection::getModifierNames($method->getModifiers()), 'function'];

    return implode(' ', $modifiers) . ' ' . $method->getName() . '(' . implode(', ', $params) . ')' . $return;
}

function propertySignature(ReflectionProperty $property): string
{
    $type = $property->getType() === null ? '' : $property->getType() . ' ';

    return implode(' ', Reflection::getModifierNames($property->getModifiers())) . ' ' . $type . '$' . $property->getName();
}

function fail(string $message): never
{
    fwrite(STDERR, "read-php.php: $message\n");
    exit(1);
}

/**
 * Loads a class of a source file by its name through the autoloader and checks that the autoloader loads it from that
 * file; a class it cannot load, or loads from another file, stops the reader with the file that declares it.
 */
function loadClass(string $file, string $path, string $fqcn): ReflectionClass
{
    try {
        $loaded = class_exists($fqcn) || interface_exists($fqcn) || trait_exists($fqcn);
    } catch (Throwable $error) {
        fail("$file: the autoloader cannot load $fqcn: " . $error->getMessage());
    }
    if (!$loaded) {
        fail("$file: the autoloader does not find $fqcn");
    }
    $class = new ReflectionClass($fqcn);
    if (realpath((string) $class->getFileName()) !== realpath($path)) {
        fail("$file: the autoloader loads $fqcn from {$class->getFileName()}");
    }

    return $class;
}

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
];

foreach ($sourceFiles as $file) {
    $path = $root . '/' . $file;
    foreach (declaredTypes(file_get_contents($path)) as $fqcn) {
        $class = loadClass($file, $path, $fqcn);
        $unit = $class->getShortName();
        $internal = ($doc = $class->getDocComment()) !== false && str_contains($doc, '@internal');
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

echo json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR), "\n";
