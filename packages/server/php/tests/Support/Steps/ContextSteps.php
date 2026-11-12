<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\ArraySession;
use Polyspec\Hyper\Context;
use Polyspec\Hyper\Csrf;
use Polyspec\Hyper\JsonCodec;
use Polyspec\Hyper\Tests\CaseReader;
use Polyspec\Hyper\Tests\Support\ContextRun;
use Polyspec\Hyper\Tests\Support\Plain;

/** HY-124 to HY-128: the cases of contracts/context.json. */
final class ContextSteps
{
    private const PROGRAMS = __DIR__ . '/../../../../../../var/contract-programs';

    /** The context of a build and a JSON text: the text is canonical, and it gives the hash of the build. */
    public static function contexts(CaseReader $case): void
    {
        $build = self::stringField($case, 'build');
        $text = Context::text(self::mapOf(JsonCodec::decode(self::stringField($case, 'context')), 'context'));
        $case->compare('context', $text);
        $case->compare('text', '{"build":"' . $build . '","context":' . $text . '}');
        $case->compare('hash', Context::hash($build, $text));
        if ($case->has('reorderedText')) {
            $reordered = JsonCodec::decode(self::stringField($case, 'reorderedText'));
            if (!$reordered instanceof \stdClass || !property_exists($reordered, 'context')) {
                throw new \UnexpectedValueException('reorderedText has no member context');
            }
            $case->compare(
                'reorderedHash',
                Context::hash($build, Context::text(self::mapOf($reordered->context, 'the member context of reorderedText'))),
            );
        }
    }

    /** The shared data whose keys the case lists, with the context in its place (HY-10, HY-128). */
    public static function withContext(CaseReader $case): void
    {
        $shared = [];
        foreach (self::stringList($case, 'shared') as $name) {
            $shared[$name] = $name;
        }
        $keys = null;
        $context = null;
        $fails = false;
        try {
            $placed = Context::withContext($shared, ['name' => 'Board']);
            $keys = array_keys($placed);
            $context = $placed['context'];
        } catch (\LogicException $error) {
            if (!str_contains($error->getMessage(), 'already holds the member context')) {
                throw $error;
            }
            $fails = true;
        }
        $case->compare('keys', $keys);
        $case->compare('context', $context);
        $case->compare('fails', $fails);
    }

    /**
     * Returns a field of a case that is a list of strings, and fails for any other value.
     *
     * @return list<string>
     */
    private static function stringList(CaseReader $case, string $name): array
    {
        $value = $case->input($name);
        if (!is_array($value) || !array_is_list($value)) {
            throw new \UnexpectedValueException("the case field {$name} is not a list of strings");
        }
        $strings = [];
        foreach ($value as $item) {
            if (!is_string($item)) {
                throw new \UnexpectedValueException("the case field {$name} is not a list of strings");
            }
            $strings[] = $item;
        }

        return $strings;
    }

    /** Returns a string field of a case, and fails for any other value. */
    private static function stringField(CaseReader $case, string $name): string
    {
        $value = $case->input($name);
        if (!is_string($value)) {
            throw new \UnexpectedValueException("the case field {$name} is not a string");
        }

        return $value;
    }

    /**
     * Returns a decoded JSON object as the map that a context handler returns: an empty object is the empty map.
     *
     * @return array<array-key, mixed>
     */
    private static function mapOf(mixed $value, string $name): array
    {
        if (!$value instanceof \stdClass) {
            throw new \UnexpectedValueException("{$name} is not a map");
        }
        $map = Plain::value($value);
        if ($map instanceof \stdClass) {
            return [];
        }
        if (!is_array($map)) {
            throw new \UnexpectedValueException("{$name} is not a map");
        }

        return $map;
    }

    /**
     * Opens the application of a case with its shared data and its context, sends its request and compares the
     * response, the failure that the response hook received (HY-60), the context calls and the shared data.
     */
    public static function cases(CaseReader $case): void
    {
        $name = self::stringField($case, 'application');
        $applications = $case->input('applications');
        if (!is_array($applications) || !is_array($applications[$name] ?? null)) {
            throw new \UnexpectedValueException("the contract has no application {$name}");
        }
        $run = new ContextRun($name, $applications[$name], self::PROGRAMS);
        $app = $run->open(
            $case->has('shared') ? self::arrayField($case, 'shared') : null,
            context: $case->has('context') ? self::stringField($case, 'context') : null,
        );
        $session = new ArraySession();
        $response = $run->send($app, $session, self::arrayField($case, 'request'));

        $case->compare('status', $response->status);
        $case->compare('headers', $response->headers);
        $case->compare('absentHeaders', $response->headers);
        $case->compare('body', $response->body);
        $case->compare('bodyContains', $response->body);
        $case->compare('bodyNotContains', $response->body);
        $case->compare('failure', $run->failure);
        if ($case->has('keys') || $case->has('sharedKeys')) {
            $json = json_decode($response->body, true, flags: JSON_THROW_ON_ERROR);
            if (!is_array($json) || !is_array($json['shared'] ?? null)) {
                throw new \UnexpectedValueException('the body of the response is not a JSON object with shared data');
            }
            $case->compare('keys', $json);
            $case->compare('sharedKeys', $json['shared']);
        }
        if ($case->has('regionKeys') || $case->has('tokenOfSession')) {
            $json = json_decode($response->body, true, flags: JSON_THROW_ON_ERROR);
            if (!is_array($json)) {
                throw new \UnexpectedValueException('the body of the response is not a JSON object');
            }
            if ($case->has('regionKeys')) {
                if (!is_array($json['regions'] ?? null)) {
                    throw new \UnexpectedValueException('the body of the response holds no regions');
                }
                $case->compare('regionKeys', $json['regions']);
            }
            if ($case->has('tokenOfSession')) {
                // HY-72.3: the masked token of the body against the token that the session holds after the request.
                $masked = is_array($json['shared'] ?? null) ? ($json['shared']['csrf'] ?? null) : null;
                $token = $session->get('_hyper_csrf');
                if (!is_string($masked) || preg_match('/^[0-9a-f]{128}$/D', $masked) !== 1) {
                    throw new \UnexpectedValueException('the body of the response holds no masked token');
                }
                if (!is_string($token)) {
                    throw new \UnexpectedValueException('the session holds no token after the request');
                }
                $case->compare('tokenOfSession', Csrf::verify($token, $masked));
            }
        }

        if ($case->has('renewals')) {
            $case->compare('renewals', $session->renewals());
        }
        $calls = $run->calls;
        $case->compare('contextCalls', count(array_filter($calls, static fn (string $call): bool => $call === 'context')));
        $case->compare('firstCalls', $calls);
        $case->compare('selection', $run->selections);
    }

    /**
     * Returns a field of a case that is a map, and fails for any other value.
     *
     * @return array<array-key, mixed>
     */
    private static function arrayField(CaseReader $case, string $name): array
    {
        $value = $case->input($name);
        // Plain gives an empty JSON object as stdClass, so that it differs from an empty list.
        if ($value instanceof \stdClass && get_object_vars($value) === []) {
            return [];
        }
        if (!is_array($value) || ($value !== [] && array_is_list($value))) {
            throw new \UnexpectedValueException("the case field {$name} is not a map");
        }

        return $value;
    }
}
