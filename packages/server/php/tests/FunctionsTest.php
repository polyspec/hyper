<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\ArraySession;
use Polyspec\Hyper\Tests\Support\ContextRun;
use Polyspec\Hyper\Tests\Support\Json;

/**
 * The host functions of contracts/functions.json (HYC-24): every case maps the kinds of its functions to functions of
 * this runtime, opens its application with them and checks the open or the response that the contract states.
 */
final class FunctionsTest extends TestCase
{
    private const PROGRAMS = __DIR__ . '/../../../../var/contract-programs';
    private const CONTRACT = __DIR__ . '/../../../../contracts/functions.json';

    /** @return iterable<string, array{0: array<string, mixed>}> */
    public static function cases(): iterable
    {
        foreach (Json::arrays(Json::file(self::CONTRACT)['cases']) as $case) {
            yield Json::string($case['id']) => [$case];
        }
    }

    /** @param array<string, mixed> $case */
    #[DataProvider('cases')]
    public function testTheCaseGivesItsStatedResult(array $case): void
    {
        $contract = Json::file(self::CONTRACT);
        $application = Json::string($case['application']);
        $definition = Json::array(Json::array($contract['applications'])[$application]);
        $run = new ContextRun($application, $definition, self::PROGRAMS);
        $functions = self::functions(Json::array($case['functions'] ?? []));
        if (($case['openFails'] ?? false) === true) {
            $error = null;
            try {
                $run->open(null, $functions);
            } catch (\Throwable $caught) {
                $error = $caught;
            }
            self::assertInstanceOf(\InvalidArgumentException::class, $error, 'the open fails with an argument error');
            if (isset($case['openError'])) {
                self::assertStringContainsString(Json::string($case['openError']), $error->getMessage(), 'openError');
            }

            return;
        }
        $app = $run->open(null, $functions);
        $response = $run->send($app, new ArraySession(), Json::array($case['request']));

        self::assertSame(self::int($case['status']), $response->status, 'status');
        if (isset($case['body'])) {
            self::assertSame(Json::string($case['body']), $response->body, 'body');
        }
        foreach (Json::strings($case['bodyContains'] ?? []) as $text) {
            self::assertStringContainsString((string) $text, $response->body, 'bodyContains');
        }
    }

    /**
     * Maps each function of a case to the function of its kind, as functionKinds of the contract states them.
     *
     * @param array<array-key, mixed> $kinds
     * @return array<string, callable|string>
     */
    private static function functions(array $kinds): array
    {
        $functions = [];
        foreach ($kinds as $name => $kind) {
            $functions[(string) $name] = match ($kind) {
                // FUN-43: a host function receives the argument list as host values.
                'suffix' => static fn (array $arguments): string => (string) $arguments[0] . '!',
                'not_a_function' => 'x',
                default => throw new \LogicException("the kind {$kind} of the contract is unknown"),
            };
        }

        return $functions;
    }

    private static function int(mixed $value): int
    {
        if (!is_int($value)) {
            throw new \LogicException('the contract value is not an integer');
        }

        return $value;
    }
}
