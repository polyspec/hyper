<?php

declare(strict_types=1);

// The scopes of the PHP files for the recipe check (HYR-5, HYR-7), which scripts/recipe/read-php.php requires: what
// each method and function writes about the class of a receiver, read from the tokens of each file (token_get_all), and
// the step registry of the case runner. A class reference names the file that declares the class and its short name;
// the reader resolves a name through the namespace and the `use` statements of the file and the classes that the
// tracked files declare, and leaves any other name without a class. The check (stated.mts) evaluates the classes.

use Polyspec\Hyper\Recipe\PhpScope;

const SCOPE_OPENERS = ['(', '[', '{', T_CURLY_OPEN, T_DOLLAR_OPEN_CURLY_BRACES];
const SCOPE_NAMES = [T_STRING, T_NAME_QUALIFIED, T_NAME_FULLY_QUALIFIED, T_NAME_RELATIVE];
const SCOPE_ASSIGN = ['=', T_PLUS_EQUAL, T_MINUS_EQUAL, T_CONCAT_EQUAL, T_COALESCE_EQUAL, T_MUL_EQUAL, T_DIV_EQUAL];
const SCOPE_MODIFIERS = [T_PUBLIC, T_PROTECTED, T_PRIVATE, T_READONLY, T_STATIC, T_VAR, T_ABSTRACT, T_FINAL];

/** The depth of the braces after a token whose id is $id, at the depth $depth before it. */
function braceDepth(int $depth, int|string $id): int
{
    if (in_array($id, ['{', T_CURLY_OPEN, T_DOLLAR_OPEN_CURLY_BRACES], true)) {
        return $depth + 1;
    }

    return $id === '}' ? $depth - 1 : $depth;
}

/** The id of a token: the token constant, or the character of a one-character token. */
function tokenId(mixed $token): int|string
{
    return is_array($token) ? $token[0] : (string) $token;
}

/** The text of a token. */
function tokenText(mixed $token): string
{
    return is_array($token) ? $token[1] : (string) $token;
}

/** @return int the index of the bracket that closes the one at $open */
function closing(array $tokens, int $open): int
{
    $depth = 0;
    $count = count($tokens);
    for ($i = $open; $i < $count; $i++) {
        $id = tokenId($tokens[$i]);
        if (in_array($id, ['(', '[', '{', T_CURLY_OPEN, T_DOLLAR_OPEN_CURLY_BRACES], true)) {
            $depth++;
        } elseif (in_array($id, [')', ']', '}'], true)) {
            $depth--;
            if ($depth === 0) {
                return $i;
            }
        }
    }

    return $count - 1;
}

/**
 * The declarations of every file: its namespace, the names that its `use` statements bind and the classes that it
 * declares, with their token ranges, and the map from a fully qualified class name to its file and short name.
 *
 * @param array<string, list<mixed>> $tokensOf
 * @return array{files: array<string, array>, classes: array<string, array{file: string, name: string}>}
 */
function phpTree(array $tokensOf): array
{
    $files = [];
    $classes = [];
    foreach ($tokensOf as $file => $tokens) {
        $namespace = '';
        $uses = [];
        $declared = [];
        $depth = 0;
        $count = count($tokens);
        for ($i = 0; $i < $count; $i++) {
            $id = tokenId($tokens[$i]);
            $depth = braceDepth($depth, $id);
            if ($id === T_NAMESPACE && $depth === 0) {
                $namespace = tokenText($tokens[$i + 1]);
            }
            if ($id === T_USE && $depth === 0) {
                $i = useStatement($tokens, $i, $uses);
                continue;
            }
            if (
                in_array($id, [T_CLASS, T_INTERFACE, T_TRAIT, T_ENUM], true) && !isReference($tokens, $i)
                && tokenId($tokens[$i + 1] ?? '') === T_STRING
            ) {
                $name = tokenText($tokens[$i + 1]);
                $open = $i;
                while (tokenId($tokens[$open]) !== '{') {
                    $open++;
                }
                $fqcn = ($namespace === '' ? '' : $namespace . '\\') . $name;
                $body = [$open + 1, closing($tokens, $open)];
                $declared[] = ['name' => $name, 'head' => [$i + 2, $open], 'body' => $body];
                $classes[$fqcn] = ['file' => $file, 'name' => $name];
            }
        }
        $files[$file] = ['namespace' => $namespace, 'uses' => $uses, 'declared' => $declared];
    }

    return ['files' => $files, 'classes' => $classes];
}

/**
 * Reads one `use` statement at $i into $uses, a group statement included; `use function` and `use const` bind no
 * class. Returns the index of its `;`.
 *
 * @param array<string, string> $uses
 */
function useStatement(array $tokens, int $i, array &$uses): int
{
    $end = $i;
    while (tokenId($tokens[$end]) !== ';') {
        $end++;
    }
    $first = tokenId($tokens[$i + 1]);
    if ($first === T_FUNCTION || $first === T_CONST) {
        return $end;
    }
    $prefix = '';
    $name = '';
    $alias = null;
    $flush = static function () use (&$prefix, &$name, &$alias, &$uses): void {
        if ($name !== '') {
            $full = ltrim($prefix . $name, '\\');
            $short = $alias ?? substr((string) strrchr('\\' . $full, '\\'), 1);
            $uses[$short] = $full;
        }
        $name = '';
        $alias = null;
    };
    for ($j = $i + 1; $j < $end; $j++) {
        $id = tokenId($tokens[$j]);
        if ($id === '{') {
            $prefix = rtrim($name, '\\') . '\\';
            $name = '';
        } elseif ($id === ',' || $id === '}') {
            $flush();
        } elseif ($id === T_AS) {
            $alias = tokenText($tokens[++$j]);
        } elseif ($id === T_NS_SEPARATOR) {
            $name .= '\\';
        } elseif (in_array($id, SCOPE_NAMES, true)) {
            $name .= tokenText($tokens[$j]);
        }
    }
    $flush();

    return $end;
}

/** @return ?array{file: string, name: string} the class that a written name of a file names, or null */
function classNamed(array $tree, string $file, string $written): ?array
{
    $info = $tree['files'][$file];
    if (str_starts_with($written, '\\')) {
        $full = substr($written, 1);
    } else {
        $parts = explode('\\', $written, 2);
        $head = $info['uses'][$parts[0]] ?? null;
        if ($head !== null) {
            $full = $head . (isset($parts[1]) ? '\\' . $parts[1] : '');
        } else {
            $full = ($info['namespace'] === '' ? '' : $info['namespace'] . '\\') . $written;
        }
    }

    return $tree['classes'][$full] ?? null;
}

/** @return ?array{file: string, name: string} the class of a written type: one name, also after `?` or with `|null` */
function writtenType(array $tree, string $file, array $tokens, int $from, int $to): ?array
{
    $names = [];
    for ($i = $from; $i < $to; $i++) {
        $id = tokenId($tokens[$i]);
        if (in_array($id, SCOPE_NAMES, true) && strtolower(tokenText($tokens[$i])) !== 'null') {
            $names[] = tokenText($tokens[$i]);
        } elseif (!in_array($id, ['?', '|', T_STRING], true)) {
            return null;
        }
    }

    return count($names) === 1 ? classNamed($tree, $file, $names[0]) : null;
}

/**
 * The parameters of a parameter list between $open and its `)`: each name with its written class, and whether a
 * visibility or readonly makes it a property of the class.
 *
 * @return list<array{name: string, type: ?array, promoted: bool}>
 */
function parameterList(array $tree, string $file, array $tokens, int $open): array
{
    $close = closing($tokens, $open);
    $out = [];
    $start = $open + 1;
    $depth = 0;
    for ($i = $open + 1; $i <= $close; $i++) {
        $id = tokenId($tokens[$i]);
        if (in_array($id, SCOPE_OPENERS, true)) {
            $depth++;
        } elseif (in_array($id, [')', ']', '}'], true) && $i < $close) {
            $depth--;
        }
        if (($id === ',' && $depth === 0) || $i === $close) {
            $promoted = false;
            $typeFrom = $start;
            $variable = null;
            for ($j = $start; $j < $i; $j++) {
                $jd = tokenId($tokens[$j]);
                if (in_array($jd, SCOPE_MODIFIERS, true)) {
                    $promoted = $promoted || $jd !== T_STATIC;
                    $typeFrom = $j + 1;
                }
                if ($jd === T_VARIABLE) {
                    $variable = $j;
                    break;
                }
            }
            if ($variable !== null) {
                $typeTo = $variable;
                $marks = [
                    '&',
                    T_ELLIPSIS,
                    T_AMPERSAND_NOT_FOLLOWED_BY_VAR_OR_VARARG,
                    T_AMPERSAND_FOLLOWED_BY_VAR_OR_VARARG,
                ];
                while ($typeTo > $typeFrom && in_array(tokenId($tokens[$typeTo - 1]), $marks, true)) {
                    $typeTo--;
                }
                $out[] = [
                    'name' => substr(tokenText($tokens[$variable]), 1),
                    'type' => writtenType($tree, $file, $tokens, $typeFrom, $typeTo),
                    'promoted' => $promoted,
                ];
            }
            $start = $i + 1;
        }
    }

    return $out;
}

/**
 * The class of the items of each parameter whose `@param` of the doc comment of a function writes a list of one class:
 * `list<X>`, `array<K, X>`, `iterable<X>` and `X[]`.
 *
 * @return array<string, array{file: string, name: string}> the class by the name of the parameter
 */
function parameterItems(array $tree, string $file, ?string $doc): array
{
    if ($doc === null) {
        return [];
    }
    $lists = '(?:list|non-empty-list|array|non-empty-array|iterable)<(?:[^<>,]+,\s*)?\\\\?([A-Za-z_][\w\\\\]*)>';
    $pattern = '/@param\s+(?:' . $lists . '|\\\\?([A-Za-z_][\w\\\\]*)\[\])\s+(?:\.\.\.)?\$(\w+)/';
    preg_match_all($pattern, $doc, $found, PREG_SET_ORDER);
    $items = [];
    foreach ($found as $match) {
        $class = classNamed($tree, $file, $match[1] !== '' ? $match[1] : $match[2]);
        if ($class !== null) {
            $items[$match[3]] = $class;
        }
    }

    return $items;
}

/** The doc comment of a function whose `function` is at $i: before the first of its modifiers. */
function functionDoc(array $docs, array $tokens, int $i): ?string
{
    while ($i > 0 && in_array(tokenId($tokens[$i - 1]), SCOPE_MODIFIERS, true)) {
        $i--;
    }

    return $docs[$i] ?? null;
}

/**
 * The classes and the scopes of the files, and the registry entries of the registry file (HYR-5, HYR-7).
 *
 * @param list<string> $files
 * @return array{classes: list<array>, scopes: list<array>, registry: list<array>}
 */
function phpScopes(string $root, array $files, ?string $registry): array
{
    $tokensOf = [];
    $docsOf = [];
    foreach ($files as $file) {
        $code = (string) file_get_contents($root . '/' . $file);
        $tokensOf[$file] = significant($code);
        $docsOf[$file] = docComments($code);
    }
    $tree = phpTree($tokensOf);
    $classes = [];
    $scopes = [];
    foreach ($tokensOf as $file => $t) {
        $info = $tree['files'][$file];
        $inside = [];
        foreach ($info['declared'] as $class) {
            [$headFrom, $headTo] = $class['head'];
            $extends = [];
            for ($i = $headFrom; $i < $headTo; $i++) {
                if (in_array(tokenId($t[$i]), SCOPE_NAMES, true)) {
                    $found = classNamed($tree, $file, tokenText($t[$i]));
                    if ($found !== null) {
                        $extends[] = $found;
                    }
                }
            }
            [$from, $to] = $class['body'];
            $inside[] = [$from, $to];
            $properties = [];
            $depth = 0;
            for ($i = $from; $i < $to; $i++) {
                $id = tokenId($t[$i]);
                $depth = braceDepth($depth, $id);
                if ($depth !== 0) {
                    continue;
                }
                if (in_array($id, SCOPE_MODIFIERS, true)) {
                    $j = $i;
                    while (in_array(tokenId($t[$j]), SCOPE_MODIFIERS, true)) {
                        $j++;
                    }
                    $variable = $j;
                    $stops = [T_VARIABLE, T_FUNCTION, T_CONST, ';'];
                    while ($variable < $to && !in_array(tokenId($t[$variable]), $stops, true)) {
                        $variable++;
                    }
                    if (tokenId($t[$variable]) === T_VARIABLE) {
                        $type = writtenType($tree, $file, $t, $j, $variable);
                        $property = ['name' => substr(tokenText($t[$variable]), 1)];
                        $properties[] = $property + ($type === null ? [] : ['type' => $type]);
                        $i = $variable;
                    } else {
                        $i = $j - 1;
                    }
                    continue;
                }
                if ($id === T_FUNCTION && tokenId($t[$i + 1] ?? ';') === T_STRING) {
                    $method = tokenText($t[$i + 1]);
                    $scope = new PhpScope($tree, $file, $t, ['file' => $file, 'name' => $class['name']]);
                    $items = parameterItems($tree, $file, functionDoc($docsOf[$file], $t, $i));
                    foreach (parameterList($tree, $file, $t, $i + 2) as $p) {
                        $scope->parameters[] = $p + (isset($items[$p['name']]) ? ['items' => $items[$p['name']]] : []);
                        if ($p['promoted']) {
                            $typed = $p['type'] === null ? [] : ['type' => $p['type']];
                            $properties[] = ['name' => $p['name']] + $typed;
                        }
                    }
                    $close = closing($t, $i + 2);
                    $j = $close + 1;
                    while (!in_array(tokenId($t[$j]), ['{', ';'], true)) {
                        $j++;
                    }
                    $end = tokenId($t[$j]) === '{' ? closing($t, $j) : $j;
                    $scope->read($j + 1, $end);
                    $own = ['file' => $file, 'name' => $class['name']];
                    $returns = returnType($tree, $file, $t, $close + 1, $j, $own);
                    $scopes[] = scopeEntry($file, "{$class['name']}.{$method}", $class['name'], $scope, $returns);
                    $i = $end;
                }
            }
            $classes[] = [
                'file' => $file,
                'name' => $class['name'],
                'extends' => $extends,
                'properties' => $properties,
            ];
        }
        $count = count($t);
        for ($i = 0; $i < $count; $i++) {
            foreach ($inside as [$from, $to]) {
                if ($i >= $from && $i <= $to) {
                    $i = $to;
                    continue 2;
                }
            }
            if (tokenId($t[$i]) === T_FUNCTION && tokenId($t[$i + 1] ?? ';') === T_STRING) {
                $scope = new PhpScope($tree, $file, $t);
                $items = parameterItems($tree, $file, functionDoc($docsOf[$file], $t, $i));
                foreach (parameterList($tree, $file, $t, $i + 2) as $p) {
                    $scope->parameters[] = $p + (isset($items[$p['name']]) ? ['items' => $items[$p['name']]] : []);
                }
                $close = closing($t, $i + 2);
                $j = $close + 1;
                while (tokenId($t[$j]) !== '{') {
                    $j++;
                }
                $end = closing($t, $j);
                $scope->read($j + 1, $end);
                $returns = returnType($tree, $file, $t, $close + 1, $j, null);
                $scopes[] = scopeEntry($file, tokenText($t[$i + 1]), null, $scope, $returns);
                $i = $end;
            }
        }
    }

    $entries = $registry === null ? [] : phpRegistry($tree, $tokensOf, $registry);

    return ['classes' => $classes, 'scopes' => $scopes, 'registry' => $entries];
}

/** @return array the output entry of a scope */
function scopeEntry(string $file, string $name, ?string $class, PhpScope $scope, ?array $returns): array
{
    $parameters = array_map(
        static fn ($p) => ['name' => $p['name']] + ($p['type'] === null ? [] : ['type' => $p['type']])
            + (isset($p['items']) ? ['items' => $p['items']] : []),
        $scope->parameters,
    );

    return ['file' => $file, 'name' => $name] + ($class === null ? [] : ['class' => $class]) + [
        'parameters' => $parameters,
        'uses' => $scope->uses,
        'assigns' => $scope->assigns,
        'loops' => $scope->loops,
    ] + ($returns === null ? [] : ['returns' => $returns]);
}

/**
 * The written return type of a function whose `)` is before $from and whose body or `;` is at $to: one class, also
 * after `?` or with `|null`, where `self` and `static` are the class $own.
 *
 * @return ?array{file: string, name: string}
 */
function returnType(array $tree, string $file, array $tokens, int $from, int $to, ?array $own): ?array
{
    if (tokenId($tokens[$from] ?? ';') !== ':') {
        return null;
    }
    $names = [];
    for ($i = $from + 1; $i < $to; $i++) {
        $id = tokenId($tokens[$i]);
        if ($id === T_STATIC || (in_array($id, SCOPE_NAMES, true) && strtolower(tokenText($tokens[$i])) !== 'null')) {
            $names[] = tokenText($tokens[$i]);
        } elseif (!in_array($id, ['?', '|'], true)) {
            return null;
        }
    }
    if (count($names) !== 1) {
        return null;
    }

    return in_array(strtolower($names[0]), ['self', 'static'], true) ? $own : classNamed($tree, $file, $names[0]);
}

/**
 * The arms `'<case file> <section>' => <Class>::<method>(...)` of the registry file.
 *
 * @param array<string, list<mixed>> $tokensOf
 * @return list<array{file: string, section: string, step: array{file: string, name: string}}>
 */
function phpRegistry(array $tree, array $tokensOf, string $registry): array
{
    if (!isset($tokensOf[$registry])) {
        fail("the registry $registry is no tracked file");
    }
    $t = $tokensOf[$registry];
    $entries = [];
    $count = count($t);
    for ($i = 0; $i + 6 < $count; $i++) {
        if (
            tokenId($t[$i]) !== T_CONSTANT_ENCAPSED_STRING || tokenId($t[$i + 1]) !== T_DOUBLE_ARROW
            || !in_array(tokenId($t[$i + 2]), SCOPE_NAMES, true) || tokenId($t[$i + 3]) !== T_DOUBLE_COLON
            || tokenId($t[$i + 4]) !== T_STRING || tokenId($t[$i + 5]) !== '(' || tokenId($t[$i + 6]) !== T_ELLIPSIS
        ) {
            continue;
        }
        $key = explode(' ', substr(tokenText($t[$i]), 1, -1), 2);
        $class = classNamed($tree, $registry, tokenText($t[$i + 2]));
        $entries[] = [
            'file' => $key[0],
            'section' => $key[1] ?? '',
            'step' => [
                'file' => $class['file'] ?? '',
                'name' => ($class['name'] ?? tokenText($t[$i + 2])) . '.' . tokenText($t[$i + 4]),
            ],
        ];
    }

    return $entries;
}
