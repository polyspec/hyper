<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\ArraySession;
use Polyspec\Hyper\Tests\CaseReader;
use Polyspec\Hyper\Tests\Support\ContextRun;

/** HY-118, HY-123: the cases of contracts/representations.json. */
final class RepresentationsSteps
{
    private const PROGRAMS = __DIR__ . '/../../../../../../var/contract-programs';

    /** HY-118: the manifest check rejects a route whose representations do not open. */
    public static function manifestRejections(CaseReader $case): void
    {
        $route = (string) $case->input('route');
        $representations = $case->input('representations');
        $definition = self::application($case);
        $definition['manifest']['routes'] = array_map(
            static fn (mixed $spec): mixed => is_array($spec) && ($spec['name'] ?? null) === $route
                ? [...$spec, 'representations' => $representations]
                : $spec,
            is_array($definition['manifest']['routes'] ?? null) ? $definition['manifest']['routes'] : [],
        );
        $case->outcome('open', self::opens($definition) === false);
    }

    /** HY-118: opening the application fails for an entry without a handler. */
    public static function openRejections(CaseReader $case): void
    {
        $case->input('route');
        $case->input('handlers');
        $case->outcome('open', self::opens(self::application($case)) === false);
    }

    /** HY-118, HY-123: the request of a case receives the response of the representations application. */
    public static function cases(CaseReader $case): void
    {
        $case->input('basePath');
        $case->input('handler');
        $run = new ContextRun('representations', self::application($case), self::PROGRAMS);
        $response = $run->send($run->open(null), new ArraySession(), (array) $case->input('request'));
        $case->compare('status', $response->status);
        $case->compare('headers', $response->headers);
        $case->compare('body', $response->body);
        $case->compare('absentHeaders', $response->headers);
        // The page, the handled, the session and the received fields are not compared yet (H28.7).
    }

    /** @return array<string, mixed> */
    private static function application(CaseReader $case): array
    {
        $applications = $case->input('applications');

        return is_array($applications) && is_array($applications['representations'] ?? null)
            ? $applications['representations']
            : [];
    }

    /** @param array<string, mixed> $definition */
    private static function opens(array $definition): bool
    {
        try {
            (new ContextRun('representations', $definition, self::PROGRAMS))->open(null);
        } catch (\InvalidArgumentException) {
            return false;
        }

        return true;
    }
}
