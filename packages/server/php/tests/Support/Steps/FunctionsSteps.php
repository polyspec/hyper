<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\ArraySession;
use Polyspec\Hyper\Tests\CaseReader;
use Polyspec\Hyper\Tests\Support\ContextRun;

/** HYC-24: the cases of contracts/functions.json. */
final class FunctionsSteps
{
    private const PROGRAMS = __DIR__ . '/../../../../../../var/contract-programs';

    public static function cases(CaseReader $case): void
    {
        $application = (string) $case->input('application');
        $applications = $case->input('applications');
        $definition = is_array($applications) && is_array($applications[$application] ?? null)
            ? $applications[$application]
            : [];
        $run = new ContextRun($application, $definition, self::PROGRAMS);
        $functions = self::functions($case->input('functions'), $case->input('functionKinds'));

        $error = null;
        try {
            $app = $run->open(null, $functions);
        } catch (\Throwable $caught) {
            $error = $caught;
        }
        $case->compare('openFails', $error);
        $case->compare('openError', $error?->getMessage());
        if ($error !== null) {
            return;
        }

        $response = $run->send($app, new ArraySession(), (array) $case->input('request'));
        $case->compare('status', $response->status);
        $case->compare('body', $response->body);
        $case->compare('bodyContains', $response->body);
    }

    /**
     * Maps each function of a case to the function of its kind, as functionKinds of the contract states them.
     *
     * @return array<string, callable|string>
     */
    private static function functions(mixed $kinds, mixed $declared): array
    {
        $functions = [];
        foreach (is_array($kinds) ? $kinds : [] as $name => $kind) {
            if (!is_array($declared) || !array_key_exists((string) $kind, $declared)) {
                throw new \LogicException("the kind {$kind} is not a functionKinds of the contract");
            }
            $functions[(string) $name] = match ($kind) {
                // FUN-43: a host function receives the argument list as host values.
                'suffix' => static fn (array $arguments): string => (string) $arguments[0] . '!',
                'not_a_function' => 'x',
                default => throw new \LogicException("the kind {$kind} of the contract is unknown"),
            };
        }

        return $functions;
    }
}
