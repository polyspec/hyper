<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\ArraySession;
use Polyspec\Hyper\Context;
use Polyspec\Hyper\Csrf;
use Polyspec\Hyper\Tests\CaseReader;
use Polyspec\Hyper\Tests\Support\CaseInput;
use Polyspec\Hyper\Tests\Support\ContextRun;
use Polyspec\Hyper\Tests\Support\Json;

/** HY-124 to HY-128: the cases of contracts/context.json. */
final class ContextSteps
{
    private const PROGRAMS = __DIR__ . '/../../../../../var/contract-programs';

    /** The context of a build and a JSON text: the text is canonical, and it gives the hash of the build. */
    public static function contexts(CaseReader $case): void
    {
        $build = self::stringField($case, 'build');
        $text = Context::text(Json::map(Json::value(self::stringField($case, 'context')), 'context'));
        $case->compare('context', $text);
        $case->compare('text', '{"build":"' . $build . '","context":' . $text . '}');
        $case->compare('hash', Context::hash($build, $text));
        if ($case->has('reorderedText')) {
            $reordered = Json::map(Json::value(self::stringField($case, 'reorderedText')), 'reorderedText');
            if (!array_key_exists('context', $reordered)) {
                throw new \UnexpectedValueException('reorderedText has no member context');
            }
            $context = Json::map($reordered['context'], 'the member context of reorderedText');
            $case->compare('reorderedHash', Context::hash($build, Context::text($context)));
        }
    }

    /**
     * Returns the shared data of a case with each marker `{"$": "kind", "name": <kind>}` replaced by the value of that
     * kind of the fixture `valueKinds`, which JSON cannot state; a kind that PHP has no value for fails the case.
     *
     * @param array<array-key, mixed> $value
     * @param array<array-key, mixed> $kinds
     *
     * @return array<array-key, mixed>
     */
    private static function withKinds(array $value, array $kinds): array
    {
        $resolved = [];
        foreach ($value as $key => $item) {
            if (is_array($item) && ($item['$'] ?? null) === 'kind') {
                $kind = Json::string($item['name'] ?? null);
                if (!array_key_exists($kind, $kinds)) {
                    throw new \UnexpectedValueException("valueKinds does not hold the kind {$kind}");
                }
                $resolved[$key] = match ($kind) {
                    // The three bytes ED A0 80, the UTF-8 form of U+D800, which is no UTF-8 text.
                    'loneSurrogate' => "\xED\xA0\x80",
                    'resource' => fopen('php://memory', 'r'),
                    default => throw new \UnexpectedValueException("the kind {$kind} has no value in PHP"),
                };
                continue;
            }
            $resolved[$key] = is_array($item) ? self::withKinds($item, $kinds) : $item;
        }

        return $resolved;
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
        $kinds = Json::map($case->input('valueKinds'), 'valueKinds');
        $app = $run->open(
            $case->has('shared') ? self::withKinds(CaseInput::map($case, 'shared'), $kinds) : null,
            context: $case->has('context') ? self::stringField($case, 'context') : null,
        );
        $session = new ArraySession();
        $response = $run->send($app, $session, CaseInput::map($case, 'request'));

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
        $case->compare('contextCalls', count(array_keys($calls, 'context', true)));
        $case->compare('firstCalls', $calls);
        $case->compare('selection', $run->selections);
    }
}
