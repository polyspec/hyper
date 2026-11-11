<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\BadRequest;
use Polyspec\Hyper\Forbidden;
use Polyspec\Hyper\NotFound;
use Polyspec\Hyper\Redirect;
use Polyspec\Hyper\Result;
use Polyspec\Hyper\Tests\CaseReader;
use Polyspec\Hyper\Tests\Support\Plain;
use Polyspec\Template\Value\BindError;

/** HY-25, HY-27, HY-46, HY-50, HY-58: the cases of contracts/result.json, the results of actions and the stops. */
final class ResultSteps
{
    /** Makes a redirect to the location, or records the message of the error with which it fails (HY-46). */
    public static function redirect(CaseReader $case): void
    {
        $result = null;
        $error = null;
        try {
            // `notUtf8` appends the byte FF, which is not UTF-8 text.
            $notUtf8 = $case->has('notUtf8') && $case->input('notUtf8') === true;
            $result = Result::redirect(self::text($case, 'location') . ($notUtf8 ? "\xFF" : ''));
        } catch (\InvalidArgumentException $failure) {
            $error = $failure->getMessage();
        }
        $case->compare('redirect', $result?->location);
        $case->compare('status', $result?->status);
        $case->compare('error', $error);
    }

    /** Makes the page with the status and the data, or records the message of the error with which it fails (HY-58). */
    public static function page(CaseReader $case): void
    {
        $result = null;
        $error = null;
        try {
            $result = Result::page(self::integer($case, 'status'), self::data($case, 'data'));
        } catch (\InvalidArgumentException $failure) {
            $error = $failure->getMessage();
        }
        $case->compare('result', $result?->status);
        $case->compare('redirect', $result?->location);
        $case->compare('error', $error);
    }

    /** Makes the invalid result with the data (HY-26). */
    public static function invalid(CaseReader $case): void
    {
        $result = Result::invalid(self::data($case, 'data'));
        $case->compare('status', $result->status);
        $case->compare('redirect', $result->location);
    }

    /**
     * Stores the flash values and records the changed topics on a redirect, or records the message of the error of the
     * data model with which storing fails (HY-25).
     */
    public static function copies(CaseReader $case): void
    {
        $flashes = [];
        foreach (self::list($case, 'flashes') as $pair) {
            if (
                !is_array($pair) || !array_is_list($pair) || count($pair) !== 2
                || !is_string($pair[0]) || !is_string($pair[1])
            ) {
                throw new \UnexpectedValueException('a flash of the case is not a name and a JSON text');
            }
            // The JSON text gives the value as a handler returns it, with arrays for maps (HY-44).
            $flashes[] = [$pair[0], json_decode($pair[1], true, 512, JSON_THROW_ON_ERROR)];
        }
        $topics = [];
        foreach (self::list($case, 'topics') as $names) {
            if (!is_array($names) || !array_is_list($names) || array_filter($names, is_string(...)) !== $names) {
                throw new \UnexpectedValueException('topics of the case are not a list of strings');
            }
            $topics[] = $names;
        }
        $result = Result::redirect('/');
        $error = null;
        try {
            foreach ($flashes as [$name, $value]) {
                $result = $result->flash($name, $value);
            }
            foreach ($topics as $names) {
                $result = $result->changed(...$names);
            }
        } catch (BindError $failure) {
            $result = null;
            $error = $failure->getMessage();
        }
        $case->compare('flashValues', $result === null ? null : Plain::map($result->flashValues));
        $case->compare('changedTopics', $result?->changedTopics);
        $case->compare('error', $error);
    }

    /** Makes the stop of the kind, or records the message of the error with which it fails (HY-27, HY-50). */
    public static function stop(CaseReader $case): void
    {
        $stop = null;
        $error = null;
        $kind = self::text($case, 'kind');
        try {
            $stop = match ($kind) {
                'NotFound' => new NotFound(),
                'Forbidden' => new Forbidden(),
                'BadRequest' => new BadRequest(),
                'Redirect' => new Redirect(
                    $case->has('redirect')
                        ? Result::redirect(self::text($case, 'redirect'))
                        : Result::page(self::integer($case, 'page'), []),
                ),
                default => throw new \UnexpectedValueException("the stop {$kind} of the case is unknown"),
            };
        } catch (\InvalidArgumentException $failure) {
            $error = $failure->getMessage();
        }
        $case->compare('message', $stop?->getMessage());
        $case->compare('error', $error);
    }

    private static function text(CaseReader $case, string $name): string
    {
        $value = $case->input($name);

        return is_string($value)
            ? $value
            : throw new \UnexpectedValueException("the case field {$name} is not a string");
    }

    private static function integer(CaseReader $case, string $name): int
    {
        $value = $case->input($name);

        return is_int($value)
            ? $value
            : throw new \UnexpectedValueException("the case field {$name} is not an integer");
    }

    /** @return list<mixed> */
    private static function list(CaseReader $case, string $name): array
    {
        $value = $case->input($name);

        return is_array($value) && array_is_list($value)
            ? $value
            : throw new \UnexpectedValueException("the case field {$name} is not a list");
    }

    /** @return array<string, mixed> */
    private static function data(CaseReader $case, string $name): array
    {
        $value = $case->input($name);
        if ($value instanceof \stdClass) {
            $value = get_object_vars($value);
        }
        if (!is_array($value) || ($value !== [] && array_is_list($value))) {
            throw new \UnexpectedValueException("the case field {$name} is not a map");
        }
        $map = [];
        foreach ($value as $key => $item) {
            // A key of a JSON object is a string, also one that PHP would write as an integer key.
            $map[(string) $key] = Plain::value($item);
        }

        return $map;
    }
}
