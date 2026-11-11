<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\ArraySession;
use Polyspec\Hyper\Context;
use Polyspec\Hyper\Tests\Support\ContextRun;
use Polyspec\Hyper\Tests\Support\Json;

/**
 * HY-124 to HY-128: the cases of contracts/context.json, which the PHP, Node and Python servers pass. The programs of
 * the applications are built by scripts/contract-programs.mjs (`make server-fixtures`).
 */
final class ContextTest extends TestCase
{
    private const PROGRAMS = __DIR__ . '/../../../../var/contract-programs';

    /** @return array<array-key, mixed> */
    private static function conformance(): array
    {
        return Json::file(__DIR__ . '/../../../../contracts/context.json');
    }

    /** @return iterable<string, array{array<array-key, mixed>}> */
    public static function contexts(): iterable
    {
        foreach (Json::arrays(self::conformance()['contexts']) as $context) {
            yield Json::string($context['id']) => [$context];
        }
    }

    /** @return iterable<string, array{array<array-key, mixed>}> */
    public static function cases(): iterable
    {
        foreach (Json::arrays(self::conformance()['cases']) as $case) {
            yield Json::string($case['id']) => [$case];
        }
    }

    /** @param array<array-key, mixed> $context */
    #[DataProvider('contexts')]
    public function testTheHashIsTheDigestOfTheBuildAndTheJsonText(array $context): void
    {
        $build = Json::string($context['build']);
        $text = Json::string($context['context']);

        self::assertSame($text, Context::text(Json::array(json_decode($text, true, flags: JSON_THROW_ON_ERROR))));
        self::assertSame(
            Json::string($context['text']),
            '{"build":"' . $build . '","context":' . $text . '}',
        );
        self::assertSame(Json::string($context['hash']), Context::hash($build, $text));
        if (isset($context['reorderedText'], $context['reorderedHash'])) {
            $reordered = Json::string($context['reorderedText']);
            $prefix = '{"build":"' . $build . '","context":';
            self::assertStringStartsWith($prefix, $reordered);
            $map = substr($reordered, strlen($prefix), -1);
            self::assertSame(Json::string($context['reorderedHash']), Context::hash($build, $map));
            self::assertNotSame(Json::string($context['hash']), Context::hash($build, $map));
        }
    }

    private static function int(mixed $value): int
    {
        if (!is_int($value)) {
            throw new \LogicException("the contract value is not an integer");
        }

        return $value;
    }

    /** @param array<array-key, mixed> $case */
    #[DataProvider('cases')]
    public function testTheCaseGivesItsStatedResponse(array $case): void
    {
        $application = Json::string($case['application']);
        $definition = Json::array(self::conformance()['applications'][$application]);
        $run = new ContextRun($application, $definition, self::PROGRAMS);
        $session = new ArraySession();
        $app = $run->open(isset($case['shared']) ? Json::array($case['shared']) : null);
        $response = $run->send($app, $session, Json::array($case['request']));

        self::assertSame(self::int($case['status']), $response->status, 'status');
        foreach (Json::array($case['headers'] ?? []) as $name => $value) {
            self::assertSame($value, $response->headers[(string) $name] ?? null, "header {$name}");
        }
        foreach (Json::strings($case['absentHeaders'] ?? []) as $name) {
            self::assertArrayNotHasKey((string) $name, $response->headers, "absent header {$name}");
        }
        if (isset($case['body'])) {
            self::assertSame(Json::string($case['body']), $response->body, 'body');
        }
        foreach (Json::strings($case['bodyContains'] ?? []) as $text) {
            self::assertStringContainsString((string) $text, $response->body, 'bodyContains');
        }
        foreach (Json::strings($case['bodyNotContains'] ?? []) as $text) {
            self::assertStringNotContainsString((string) $text, $response->body, 'bodyNotContains');
        }
        if (isset($case['keys'])) {
            self::assertSame(Json::strings($case['keys']), array_keys(Json::decode($response->body)), 'keys');
        }
        if (isset($case['sharedKeys'])) {
            $json = Json::decode($response->body);
            self::assertSame(
                Json::strings($case['sharedKeys']),
                array_keys(Json::array($json['shared'] ?? null)),
                'sharedKeys',
            );
        }
        $contextCalls = count(array_filter($run->calls, static fn (string $call): bool => $call === 'context'));
        if (isset($case['contextCalls'])) {
            self::assertSame(self::int($case['contextCalls']), $contextCalls, 'contextCalls');
        }
        if (isset($case['firstCalls'])) {
            $expected = Json::strings($case['firstCalls']);
            self::assertSame($expected, array_slice($run->calls, 0, count($expected)), 'firstCalls');
        }
        if (array_key_exists('selection', $case)) {
            $expected = Json::array($case['selection']);
            foreach ($run->selections as $i => $selection) {
                self::assertArrayHasKey($i, $expected, 'selection');
                self::assertSame($expected[$i], $selection, "selection {$i}");
            }
        }
    }
}
