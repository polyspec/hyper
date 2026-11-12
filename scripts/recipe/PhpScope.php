<?php

declare(strict_types=1);

// The reading of the expressions of one PHP scope for the recipe check (HYR-5), which scripts/recipe/read-php.php
// requires and scripts/recipe/read-php-scopes.php uses. Its helpers (tokenId, tokenText, closing, classNamed,
// writtenType, parameterList) are global functions of that file, which PHP finds from this namespace.

namespace Polyspec\Hyper\Recipe;

/** The reading of the expressions of one scope of a file. */
final class PhpScope
{
    /** @var list<array> */
    public array $uses = [];
    /** @var list<array> */
    public array $assigns = [];
    /** @var list<array> */
    public array $loops = [];
    /** @var list<array> */
    public array $parameters = [];
    /** @var array<string, true> */
    private array $seen = [];

    /** @param ?array{file: string, name: string} $own the class of the scope, which `new self` and `new static` construct */
    public function __construct(
        private readonly array $tree,
        private readonly string $file,
        private readonly array $tokens,
        private readonly ?array $own = null,
    ) {
    }

    /** @return array{0: array, 1: int, 2: list<array>}|null the chain that starts at $i, the index after it and its nodes */
    public function chain(int $i): ?array
    {
        $t = $this->tokens;
        $id = tokenId($t[$i] ?? ';');
        $next = tokenId($t[$i + 1] ?? ';');
        $nodes = [];
        if ($id === T_VARIABLE) {
            $text = tokenText($t[$i]);
            $expr = $text === '$this' ? ['kind' => 'own'] : ['kind' => 'variable', 'name' => substr($text, 1)];
            $i++;
        } elseif ($id === T_NEW) {
            $nameId = tokenId($t[$i + 1] ?? ';');
            if (!in_array($nameId, SCOPE_NAMES, true) && $nameId !== T_STATIC) {
                return null;
            }
            $written = tokenText($t[$i + 1]);
            $class = in_array(strtolower($written), ['self', 'static'], true)
                ? $this->own
                : classNamed($this->tree, $this->file, $written);
            $expr = $class === null ? ['kind' => 'other'] : ['kind' => 'new', 'class' => $class];
            if ($class !== null) {
                $nodes[] = $expr;
            }
            $i += 2;
            if (tokenId($t[$i] ?? ';') === '(') {
                $i = closing($t, $i) + 1;
            }
        } elseif ((in_array($id, SCOPE_NAMES, true) || $id === T_STATIC) && $next === T_DOUBLE_COLON) {
            $text = strtolower(tokenText($t[$i]));
            if ($text === 'self' || $text === 'static') {
                $expr = ['kind' => 'own'];
            } elseif ($text === 'parent') {
                $expr = ['kind' => 'parent'];
            } else {
                $class = classNamed($this->tree, $this->file, tokenText($t[$i]));
                $expr = $class === null ? ['kind' => 'other'] : ['kind' => 'class'] + $class;
            }
            $i++;
        } elseif ($id === '(') {
            $close = closing($t, $i);
            $after = tokenId($t[$close + 1] ?? ';');
            if (!in_array($after, [T_OBJECT_OPERATOR, T_NULLSAFE_OBJECT_OPERATOR], true)) {
                return null;
            }
            $expr = $this->value($i + 1, $close);
            $i = $close + 1;
        } else {
            return null;
        }
        return $this->postfix($expr, $i, $nodes);
    }

    /** @return array{0: array, 1: int, 2: list<array>} the member reads and calls after a receiver */
    private function postfix(array $expr, int $i, array $nodes): array
    {
        $t = $this->tokens;
        while (true) {
            $id = tokenId($t[$i] ?? ';');
            if (in_array($id, [T_OBJECT_OPERATOR, T_NULLSAFE_OBJECT_OPERATOR, T_DOUBLE_COLON], true)) {
                $nameToken = $t[$i + 1] ?? ';';
                if (tokenId($nameToken) !== T_STRING) {
                    return [['kind' => 'other'], $i, $nodes];
                }
                $call = tokenId($t[$i + 2] ?? ';') === '(';
                if ($id === T_DOUBLE_COLON && !$call) {
                    return [['kind' => 'other'], $i + 2, $nodes];
                }
                $expr = ['kind' => 'member', 'of' => $expr, 'name' => tokenText($nameToken), 'call' => $call];
                $nodes[] = $expr;
                $i += 2;
                if ($call) {
                    $i = closing($t, $i) + 1;
                }
            } elseif ($id === '[' || $id === '(') {
                $expr = ['kind' => 'other'];
                $i = closing($t, $i) + 1;
            } else {
                return [$expr, $i, $nodes];
            }
        }
    }

    /** @return int the end of a value that starts at $i: its `;`, or the `,` or closing bracket at its own depth */
    public function valueEnd(int $i, int $limit): int
    {
        $depth = 0;
        for (; $i < $limit; $i++) {
            $id = tokenId($this->tokens[$i]);
            if (in_array($id, SCOPE_OPENERS, true)) {
                $depth++;
            } elseif (in_array($id, [')', ']', '}'], true)) {
                if ($depth === 0) {
                    return $i;
                }
                $depth--;
            } elseif (($id === ';' || $id === ',' || $id === T_DOUBLE_ARROW) && $depth === 0) {
                return $i;
            }
        }

        return $limit;
    }

    /** The expression of the tokens from $from to $to: one chain, or the alternatives of `??`, `?:` and `? :`. */
    public function value(int $from, int $to): array
    {
        $t = $this->tokens;
        $depth = 0;
        $parts = [];
        $start = $from;
        for ($i = $from; $i < $to; $i++) {
            $id = tokenId($t[$i]);
            if (in_array($id, SCOPE_OPENERS, true)) {
                $depth++;
            } elseif (in_array($id, [')', ']', '}'], true)) {
                $depth--;
            } elseif ($depth === 0 && $id === T_COALESCE) {
                $parts[] = [$start, $i];
                $start = $i + 1;
            } elseif ($depth === 0 && $id === '?') {
                $colon = $this->colon($i + 1, $to);
                $first = $colon === $i + 1 ? $this->value($start, $i) : $this->value($i + 1, $colon);
                $parts = array_map(fn ($p) => $this->value($p[0], $p[1]), $parts);

                return ['kind' => 'either', 'of' => [...$parts, $first, $this->value($colon + 1, $to)]];
            }
        }
        if ($parts !== []) {
            $parts[] = [$start, $to];

            return ['kind' => 'either', 'of' => array_map(fn ($p) => $this->value($p[0], $p[1]), $parts)];
        }
        if (tokenId($t[$from] ?? ';') === T_MATCH) {
            return $this->matchValue($from, $to);
        }
        if (tokenId($t[$from] ?? ';') === T_CLONE) {
            $from++;
        }
        $chain = $this->chain($from);
        if ($chain !== null && $chain[1] === $to) {
            return $chain[0];
        }
        if (tokenId($t[$from] ?? ';') === '(' && closing($t, $from) === $to - 1) {
            return $this->value($from + 1, $to - 1);
        }

        return ['kind' => 'other'];
    }

    /** A `match` from $from to $to: the conditional of the values of its arms, each after its `=>`. */
    private function matchValue(int $from, int $to): array
    {
        $t = $this->tokens;
        $open = $from + 1;
        if (tokenId($t[$open] ?? ';') !== '(') {
            return ['kind' => 'other'];
        }
        $body = closing($t, $open) + 1;
        if (tokenId($t[$body] ?? ';') !== '{' || closing($t, $body) !== $to - 1) {
            return ['kind' => 'other'];
        }
        $arms = [];
        $i = $body + 1;
        while ($i < $to - 1) {
            $arrow = $this->valueEnd($i, $to - 1);
            while ($arrow < $to - 1 && tokenId($t[$arrow]) === ',') {
                $arrow = $this->valueEnd($arrow + 1, $to - 1);
            }
            if (tokenId($t[$arrow] ?? ';') !== T_DOUBLE_ARROW) {
                break;
            }
            $end = $this->valueEnd($arrow + 1, $to - 1);
            $arms[] = $this->value($arrow + 1, $end);
            $i = $end + 1;
        }

        return $arms === [] ? ['kind' => 'other'] : ['kind' => 'either', 'of' => $arms];
    }

    /** @return int the `:` of the conditional whose `?` is before $i */
    private function colon(int $i, int $to): int
    {
        $depth = 0;
        $nested = 0;
        for (; $i < $to; $i++) {
            $id = tokenId($this->tokens[$i]);
            if (in_array($id, SCOPE_OPENERS, true)) {
                $depth++;
            } elseif (in_array($id, [')', ']', '}'], true)) {
                $depth--;
            } elseif ($depth === 0 && $id === '?') {
                $nested++;
            } elseif ($depth === 0 && $id === ':') {
                if ($nested === 0) {
                    return $i;
                }
                $nested--;
            }
        }

        return $to;
    }

    private function use(array $node): void
    {
        $key = json_encode($node, JSON_THROW_ON_ERROR);
        if (!isset($this->seen[$key])) {
            $this->seen[$key] = true;
            $this->uses[] = $node;
        }
    }

    /** Reads the tokens from $from to $to: closures, loops, assignments and every chain; an assigned member is no use. */
    public function read(int $from, int $to): void
    {
        $t = $this->tokens;
        for ($i = $from; $i < $to; $i++) {
            $id = tokenId($t[$i]);
            if (($id === T_FUNCTION || $id === T_FN) && tokenId($t[$i + 1] ?? ';') === '(') {
                foreach (parameterList($this->tree, $this->file, $t, $i + 1) as $p) {
                    $this->parameters[] = $p;
                }
            }
            if ($id === T_FOREACH) {
                $close = closing($t, $i + 1);
                $as = $i + 2;
                $depth = 0;
                while ($as < $close && !(tokenId($t[$as]) === T_AS && $depth === 0)) {
                    $at = tokenId($t[$as]);
                    $depth += in_array($at, ['(', '['], true) ? 1 : (in_array($at, [')', ']'], true) ? -1 : 0);
                    $as++;
                }
                $variable = null;
                for ($j = $as + 1; $j < $close; $j++) {
                    if (tokenId($t[$j]) === T_VARIABLE) {
                        $variable = substr(tokenText($t[$j]), 1);
                    }
                }
                if ($variable !== null) {
                    $this->loops[] = ['variable' => $variable, 'over' => $this->value($i + 2, $as)];
                }
            }
            $chain = $this->chain($i);
            if ($chain === null) {
                continue;
            }
            [$expr, $end, $nodes] = $chain;
            $assigned = in_array(tokenId($t[$end] ?? ';'), SCOPE_ASSIGN, true);
            if ($assigned && $nodes !== [] && $expr['kind'] === 'member' && !$expr['call']) {
                array_pop($nodes);
            }
            foreach ($nodes as $node) {
                $this->use($node);
            }
            if ($assigned && tokenId($t[$end]) === '=') {
                $target = null;
                if ($expr['kind'] === 'variable') {
                    $target = $expr['name'];
                } elseif ($expr['kind'] === 'member' && $expr['of']['kind'] === 'own' && !$expr['call']) {
                    $target = ['own' => $expr['name']];
                }
                if ($target !== null) {
                    $value = $this->value($end + 1, $this->valueEnd($end + 1, $to));
                    $this->assigns[] = ['target' => $target, 'value' => $value];
                }
            }
        }
    }
}
