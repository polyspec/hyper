<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server;

/**
 * The outcome of an action: a redirect (HY-25, HY-46) or a page with a status (HY-26, HY-58), with the flash values and
 * the changed topics that it stores for the next request.
 */
final class Result
{
    /**
     * @param array<array-key, mixed> $data
     * @param array<array-key, mixed> $flashValues
     * @param list<string> $changedTopics
     */
    private function __construct(
        public readonly ?string $location,
        public readonly int $status,
        public readonly array $data,
        /** @internal */
        public readonly array $flashValues,
        /** @internal */
        public readonly array $changedTopics,
    ) {
    }

    /** Returns a redirect to a path of this application (HY-46). */
    public static function redirect(string $location): self
    {
        ArgumentCount::most(\func_num_args(), 1);
        if (
            preg_match('#^/(?![/\\\\])[^\x{00}-\x{20}\x{7F}-\x{9F}\\\\]*$#Du', $location) !== 1
            || self::hasDotSegment($location)
        ) {
            throw new \InvalidArgumentException('a redirect location is not an application path (HY-46)');
        }

        return new self($location, 303, [], [], []);
    }

    /**
     * Returns the route page with a status of 200, 409 or 422 and the data that the page renders (HY-58).
     *
     * @param array<array-key, mixed> $data
     */
    public static function page(int $status, array $data): self
    {
        ArgumentCount::most(\func_num_args(), 2);
        if (!in_array($status, [200, 409, 422], true)) {
            throw new \InvalidArgumentException("a page status {$status} is not 200, 409 or 422 (HY-58)");
        }

        return new self(null, $status, $data, [], []);
    }

    /**
     * Returns invalid input with the data that the page renders: the page with status 422 (HY-26).
     *
     * @param array<array-key, mixed> $data
     */
    public static function invalid(array $data): self
    {
        ArgumentCount::most(\func_num_args(), 1);
        return self::page(422, $data);
    }

    /**
     * Returns a copy that stores a flash value, a value of the data model, for the next request; a value outside the
     * data model fails (HY-44), and a name that is not a string fails with TypeError (HY-25.6).
     */
    public function flash(mixed $name, mixed $value): self
    {
        ArgumentCount::most(\func_num_args(), 2);
        // HY-25.6: a declared type would convert an integer name for a caller without strict types.
        if (!is_string($name)) {
            throw new \TypeError('a flash name is not a string (HY-25)');
        }
        // An assignment keeps every name and the place of a name stored again (HY-25.5); a spread would number the
        // names that PHP keeps as integer keys again.
        // HY-25.4: the value is checked, and the value as the handler gave it is stored.
        DataModel::check($value);
        $values = $this->flashValues;
        $values[$name] = $value;

        return new self($this->location, $this->status, $this->data, $values, $this->changedTopics);
    }

    /**
     * Returns a copy that records changed topics for the next request; a topic that it records already keeps its
     * place, and a topic that is not a string fails with TypeError (HY-25.6).
     */
    public function changed(mixed ...$topics): self
    {
        // HY-25.6: a declared type would convert an integer topic for a caller without strict types.
        foreach ($topics as $topic) {
            if (!is_string($topic)) {
                throw new \TypeError('a changed topic is not a string (HY-25)');
            }
        }
        return new self(
            $this->location,
            $this->status,
            $this->data,
            $this->flashValues,
            array_values(array_unique([...$this->changedTopics, ...$topics])),
        );
    }

    /**
     * Returns true for a redirect.
     *
     * @internal
     */
    public function isRedirect(): bool
    {
        return $this->location !== null;
    }

    /** Returns true when the path of a location has a `.` or `..` segment, also with a percent-encoded dot. */
    private static function hasDotSegment(string $location): bool
    {
        $path = substr($location, 0, strcspn($location, '?#'));
        foreach (explode('/', $path) as $segment) {
            if (in_array(str_ireplace('%2e', '.', $segment), ['.', '..'], true)) {
                return true;
            }
        }

        return false;
    }
}
