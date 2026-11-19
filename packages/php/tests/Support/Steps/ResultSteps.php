<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\BadRequest;
use Polyspec\Hyper\Forbidden;
use Polyspec\Hyper\NotFound;
use Polyspec\Hyper\Redirect;
use Polyspec\Hyper\Result;
use Polyspec\Hyper\Tests\CaseReader;
use Polyspec\Hyper\Tests\Support\CaseInput;
use Polyspec\Hyper\Tests\Support\CaseRules;
use Polyspec\Hyper\Tests\Support\Json;
use Polyspec\Hyper\Tests\Support\Plain;

/** HY-25, HY-27, HY-46, HY-50, HY-58, HY-132: the cases of contracts/result.json, the results of actions and the stops. */
final class ResultSteps
{
    /** Makes a redirect to the location, or records the failure with which it fails (HY-46). */
    public static function redirect(CaseReader $case): void
    {
        // `notUtf8` appends the byte FF, which is not UTF-8 text.
        $notUtf8 = $case->has('notUtf8') && $case->input('notUtf8') === true;
        $location = CaseInput::text($case, 'location') . ($notUtf8 ? "\xFF" : '');
        $outcome = CaseRules::failureOf(static fn (): Result => Result::redirect($location));
        $case->compare('redirect', $outcome['result']?->location);
        $case->compare('status', $outcome['result']?->status);
        $case->compare('raises', $outcome['raises']);
    }

    /** Makes an outside redirect to the location, or records the failure with which it fails (HY-132). */
    public static function outside(CaseReader $case): void
    {
        $location = CaseInput::text($case, 'location');
        $outcome = CaseRules::failureOf(static fn (): Result => Result::outside($location));
        $case->compare('outside', $outcome['result']?->location);
        $case->compare('status', $outcome['result']?->status);
        $case->compare('raises', $outcome['raises']);
    }

    /** Records the origin of the text, or null for a text that is no outside location (HY-132). */
    public static function origin(CaseReader $case): void
    {
        $case->compare('origin', Result::origin(CaseInput::text($case, 'text')));
    }

    /**
     * Calls `flash` or `changed` of an outside redirect with the decoded argument, and records the failure with which
     * it fails (HY-132).
     */
    public static function outsideStores(CaseReader $case): void
    {
        $case->compare('raises', self::stored($case, Result::outside('https://outside.example/')));
    }

    /** Makes the page with the status and the data, or records the failure with which it fails (HY-58). */
    public static function page(CaseReader $case): void
    {
        $status = CaseInput::integer($case, 'status');
        $data = self::data($case, 'data');
        $outcome = CaseRules::failureOf(static fn (): Result => Result::page($status, $data));
        $result = $outcome['result'];
        $case->compare('result', $result?->status);
        $case->compare('redirect', $result?->location);
        $case->compare('raises', $outcome['raises']);
        if ($case->has('held') && $result !== null) {
            self::compareHeld($case, $result);
        }
    }

    /** Compares the data that a page result holds. */
    private static function compareHeld(CaseReader $case, Result $result): void
    {
        $case->compare('held', Plain::map($result->data));
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
        $outcome = CaseRules::failureOf(static function () use ($flashes, $topics): Result {
            $result = Result::redirect('/');
            foreach ($flashes as [$name, $value]) {
                $result = $result->flash($name, $value);
            }
            foreach ($topics as $names) {
                $result = $result->changed(...$names);
            }

            return $result;
        });
        $result = $outcome['result'];
        $case->compare('flashValues', $result === null ? null : Plain::map($result->flashValues));
        $case->compare('changedTopics', $result?->changedTopics);
        $case->compare('raises', $outcome['raises']);
    }

    /** Calls `flash` or `changed` with the decoded argument, and records the failure with which it fails (HY-25.6). */
    public static function types(CaseReader $case): void
    {
        $case->compare('raises', self::stored($case, Result::redirect('/')));
    }

    /** Compares the location of the result of a redirect stop. */
    private static function compareLocation(CaseReader $case, Redirect $redirect): void
    {
        $case->compare('location', $redirect->result->location);
    }

    /** Makes the stop of the kind, or records the failure with which it fails (HY-27, HY-50). */
    public static function stop(CaseReader $case): void
    {
        $kind = CaseInput::text($case, 'kind');
        if (!in_array($kind, ['NotFound', 'Forbidden', 'BadRequest', 'Redirect'], true)) {
            throw new \UnexpectedValueException("the stop {$kind} of the case is unknown");
        }
        $redirect = $case->has('redirect') ? CaseInput::text($case, 'redirect') : null;
        $outside = $case->has('outside') ? CaseInput::text($case, 'outside') : null;
        $page = $kind === 'Redirect' && $redirect === null && $outside === null ? CaseInput::integer($case, 'page') : 0;
        $outcome = CaseRules::failureOf(static fn (): \Throwable => match ($kind) {
            'NotFound' => new NotFound(),
            'Forbidden' => new Forbidden(),
            'BadRequest' => new BadRequest(),
            default => new Redirect(match (true) {
                $redirect !== null => Result::redirect($redirect),
                $outside !== null => Result::outside($outside),
                default => Result::page($page, []),
            }),
        });
        $stop = $outcome['result'];
        $case->compare('message', $stop?->getMessage());
        $case->compare('raises', $outcome['raises']);
        if ($case->has('location') && $stop instanceof Redirect) {
            self::compareLocation($case, $stop);
        }
    }

    /**
     * Calls the store of the case, `flash` or `changed`, with the decoded argument on the result, and returns the
     * failure with which it fails, or null.
     *
     * @return array{kind: mixed, status: mixed, category: ?string, message: string}|null
     */
    private static function stored(CaseReader $case, Result $result): ?array
    {
        $call = CaseInput::text($case, 'call');
        if ($call !== 'flash' && $call !== 'changed') {
            throw new \UnexpectedValueException("the call {$call} of the case is unknown");
        }
        $argument = Json::value(CaseInput::text($case, 'argument'));

        return CaseRules::failureOf(static fn () => self::store($result, $call, $argument))['raises'];
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

    /** Calls the store of a case, flash or changed, with its argument on the result. */
    private static function store(Result $result, string $call, mixed $argument): void
    {
        if ($call === 'flash') {
            $result->flash($argument, null);
        } elseif ($call === 'changed') {
            $result->changed($argument);
        } else {
            throw new \UnexpectedValueException("the call {$call} of the case is unknown");
        }
    }
}
