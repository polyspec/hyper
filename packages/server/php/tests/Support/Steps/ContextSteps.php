<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\ArraySession;
use Polyspec\Hyper\Context;
use Polyspec\Hyper\Tests\CaseReader;
use Polyspec\Hyper\Tests\Support\ContextRun;

/** HY-124 to HY-128: the cases of contracts/context.json. */
final class ContextSteps
{
    private const PROGRAMS = __DIR__ . '/../../../../../../var/contract-programs';

    /** The context of a build and a JSON text: the text is canonical, and it gives the hash of the build. */
    public static function contexts(CaseReader $case): void
    {
        $build = (string) $case->input('build');
        $decoded = json_decode((string) $case->input('context'), true, flags: JSON_THROW_ON_ERROR);
        $context = Context::text(is_array($decoded) ? $decoded : []);
        $case->compare('text', '{"build":"' . $build . '","context":' . $context . '}');
        $case->compare('hash', Context::hash($build, $context));

        // The reordered text is the same context with its members in another order: its hash must follow the text.
        $reordered = $case->input('reorderedText');
        $prefix = '{"build":"' . $build . '","context":';
        $map = is_string($reordered) && str_starts_with($reordered, $prefix)
            ? substr($reordered, strlen($prefix), -1)
            : (string) $reordered;
        $case->compare('reorderedHash', Context::hash($build, $map));
    }

    public static function cases(CaseReader $case): void
    {
        $application = (string) $case->input('application');
        $applications = $case->input('applications');
        $definition = is_array($applications) && is_array($applications[$application] ?? null)
            ? $applications[$application]
            : [];
        $run = new ContextRun($application, $definition, self::PROGRAMS);
        $shared = $case->input('shared');
        $app = $run->open(is_array($shared) ? $shared : null);
        $response = $run->send($app, new ArraySession(), (array) $case->input('request'));

        $case->compare('status', $response->status);
        $case->compare('headers', $response->headers);
        $case->compare('absentHeaders', $response->headers);
        $case->compare('body', $response->body);
        $case->compare('bodyContains', $response->body);
        $case->compare('bodyNotContains', $response->body);

        $json = json_decode($response->body, true);
        $json = is_array($json) ? $json : [];
        $case->compare('keys', $json);
        $case->compare('sharedKeys', is_array($json['shared'] ?? null) ? $json['shared'] : []);

        $calls = $run->calls;
        $case->compare('contextCalls', count(array_filter($calls, static fn (string $call): bool => $call === 'context')));
        $case->compare('firstCalls', $calls);
        $case->compare('selection', $run->selections);
    }
}
