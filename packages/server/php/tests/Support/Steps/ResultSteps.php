<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server\Tests\Support\Steps;

use Polyspec\Hyper\Server\BadRequest;
use Polyspec\Hyper\Server\Forbidden;
use Polyspec\Hyper\Server\NotFound;
use Polyspec\Hyper\Server\Redirect;
use Polyspec\Hyper\Server\Result;
use Polyspec\Hyper\Server\Tests\CaseReader;
use Polyspec\Hyper\Server\Tests\Support\CaseInput;
use Polyspec\Hyper\Server\Tests\Support\Json;
use Polyspec\Hyper\Server\Tests\Support\Plain;

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
            $result = Result::redirect(CaseInput::text($case, 'location') . ($notUtf8 ? "\xFF" : ''));
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
            $result = Result::page(CaseInput::integer($case, 'status'), self::data($case, 'data'));
        } catch (\InvalidArgumentException $failure) {
            $error = $failure->getMessage();
        }
        $case->compare('result', $result?->status);
        $case->compare('redirect', $result?->location);
        $case->compare('error', $error);
        if ($case->has('held') && $result !== null) {
            $case->compare('held', Plain::map($result->data));
        }
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
            $flashes[] = [$pair[0], Json::value($pair[1])];
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
        } catch (\InvalidArgumentException $failure) {
            $result = null;
            $error = $failure->getMessage();
        }
        $case->compare('flashValues', $result === null ? null : Plain::map($result->flashValues));
        $case->compare('changedTopics', $result?->changedTopics);
        $case->compare('error', $error);
    }

    /**
     * Calls `flash` or `changed` with the decoded argument, and records the message of its TypeError, or null
     * (HY-25.6).
     */
    public static function types(CaseReader $case): void
    {
        $call = CaseInput::text($case, 'call');
        $argument = Json::value(CaseInput::text($case, 'argument'));
        $result = Result::redirect('/');
        $error = null;
        try {
            if ($call === 'flash') {
                $result->flash($argument, null);
            } elseif ($call === 'changed') {
                $result->changed($argument);
            } else {
                throw new \UnexpectedValueException("the call {$call} of the case is unknown");
            }
        } catch (\TypeError $failure) {
            $error = $failure->getMessage();
        }
        $case->compare('error', $error);
    }

    /** Makes the stop of the kind, or records the message of the error with which it fails (HY-27, HY-50). */
    /** Compares the location of the result of a redirect stop. */
    private static function compareLocation(CaseReader $case, Redirect $redirect): void
    {
        $case->compare('location', $redirect->result->location);
    }

    public static function stop(CaseReader $case): void
    {
        $stop = null;
        $error = null;
        $kind = CaseInput::text($case, 'kind');
        try {
            $stop = match ($kind) {
                'NotFound' => new NotFound(),
                'Forbidden' => new Forbidden(),
                'BadRequest' => new BadRequest(),
                'Redirect' => new Redirect(
                    $case->has('redirect')
                        ? Result::redirect(CaseInput::text($case, 'redirect'))
                        : Result::page(CaseInput::integer($case, 'page'), []),
                ),
                default => throw new \UnexpectedValueException("the stop {$kind} of the case is unknown"),
            };
        } catch (\InvalidArgumentException $failure) {
            $error = $failure->getMessage();
        }
        $case->compare('message', $stop?->getMessage());
        $case->compare('error', $error);
        if ($case->has('location') && $stop instanceof Redirect) {
            self::compareLocation($case, $stop);
        }
    }

    /** @return list<mixed> */
    private static function list(CaseReader $case, string $name): array
    {
        $value = $case->input($name);

        return is_array($value) && array_is_list($value)
            ? $value
            : throw new \UnexpectedValueException("the case field {$name} is not a list");
    }

    /** @return array<array-key, mixed> a map whose decimal names PHP keeps as integer keys */
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
            $map[$key] = Plain::value($item);
        }

        return $map;
    }
}
