<?php

declare(strict_types=1);

// The functions of the PHP reader of the recipe check (HYR-8), which scripts/recipe/read-php.php requires: the files
// that git tracks, the types and the tests that a file declares, and the members, the constants, the visibility and
// the signatures that reflection gives.

/** @return list<string> the PHP files git tracks below a directory, relative to the root, sorted */
function phpFiles(string $root, string $dir): array
{
    if (!is_dir($root . '/' . $dir)) {
        fwrite(STDERR, "read-php.php: no such directory $dir under $root\n");
        exit(1);
    }
    $command = 'git -C ' . escapeshellarg($root) . ' -c core.quotePath=false ls-files -- ' . escapeshellarg($dir);
    exec($command, $lines, $status);
    if ($status !== 0) {
        fwrite(STDERR, "read-php.php: git ls-files failed under $root\n");
        exit(1);
    }
    $found = array_values(array_filter($lines, static fn($f) => str_ends_with($f, '.php')));
    sort($found);

    return $found;
}

/**
 * @return list<array> the tokens of a file without whitespace and comments; the parse mode reads a keyword in the place
 *                     of a name, such as a method `match` or a call `self::xor()`, as a name
 */
function significant(string $code): array
{
    return array_values(array_filter(
        token_get_all($code, TOKEN_PARSE),
        static fn($t) => !is_array($t) || !in_array($t[0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true),
    ));
}

/**
 * @return array<int, string> the doc comment before each significant token of a file that follows one, by the index
 *                            of that token among the tokens that significant() returns
 */
function docComments(string $code): array
{
    $docs = [];
    $pending = null;
    $index = 0;
    foreach (token_get_all($code, TOKEN_PARSE) as $t) {
        $id = is_array($t) ? $t[0] : $t;
        if ($id === T_DOC_COMMENT) {
            $pending = $t[1];
        } elseif ($id !== T_WHITESPACE && $id !== T_COMMENT) {
            if ($pending !== null) {
                $docs[$index] = $pending;
                $pending = null;
            }
            $index++;
        }
    }

    return $docs;
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
    // A class that extends another class or is abstract has instances, so it is a class (HYR-3).
    $methods = ownMethods($class);
    $functions = $methods !== []
        && $class->getParentClass() === false
        && !$class->isAbstract()
        && !in_array('__construct', array_map(static fn($m) => $m->getName(), $methods), true);
    foreach ($methods as $method) {
        $functions = $functions && $method->isStatic();
    }

    return $functions ? 'functions' : 'class';
}

/**
 * Whether a docblock carries the @internal tag: the tag opens a line, or the one-line docblock, and is not a word of
 * the text.
 */
function docInternal(string|false $doc): bool
{
    return $doc !== false && preg_match('/^\s*(\/\*\*|\*)\s*@internal(?![\w-])/m', $doc) === 1;
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
    return ($classInternal || docInternal($member->getDocComment())) ? 'internal' : 'public';
}

function methodSignature(ReflectionMethod $method): string
{
    $params = [];
    foreach ($method->getParameters() as $p) {
        $type = $p->getType() === null ? '' : $p->getType() . ' ';
        $prefix = ($p->isPassedByReference() ? '&' : '') . ($p->isVariadic() ? '...' : '');
        $params[] = $type . $prefix . '$' . $p->getName();
    }
    $return = $method->getReturnType() === null ? '' : ': ' . $method->getReturnType();

    $modifiers = [...Reflection::getModifierNames($method->getModifiers()), 'function'];

    return implode(' ', $modifiers) . ' ' . $method->getName() . '(' . implode(', ', $params) . ')' . $return;
}

function propertySignature(ReflectionProperty $property): string
{
    $type = $property->getType() === null ? '' : $property->getType() . ' ';

    $modifiers = implode(' ', Reflection::getModifierNames($property->getModifiers()));

    return $modifiers . ' ' . $type . '$' . $property->getName();
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
