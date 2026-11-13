<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\CoreRules;
use Polyspec\Hyper\Tests\Support\CoreStandIn\Calls;

require_once __DIR__ . '/Support/CoreStandIn/functions.php';

/**
 * The rules of the core behind the names of the units of the PHP server (CoreRules, HY-132.2), against stand-in
 * functions of the binding, which record each call and return the value that the test gives them, so the tests need no
 * extension. They state which function of the binding each unit calls, with which arguments, and what the unit
 * returns; the rules themselves are tested in the core.
 */
final class CoreRulesTest extends TestCase
{
    private const string STAND_IN = 'Polyspec\Hyper\Tests\Support\CoreStandIn';

    private const string TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    private const string MASK = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    protected function setUp(): void
    {
        Calls::$calls = [];
        Calls::$results = [];
    }

    /**
     * The exact units: the method of CoreRules, its arguments, the function of the binding and the value that the
     * function returns, which the unit returns as it is.
     *
     * @return array<string, array{string, list<mixed>, string, mixed}>
     */
    public static function exactUnits(): array
    {
        return [
            'Csrf::mask (HY-24.2)' => ['csrfMask', [self::TOKEN, self::MASK], 'csrfMask', 'masked'],
            'Csrf::verify (HY-24.4)' => ['csrfVerify', [self::TOKEN, 'value'], 'csrfVerify', true],
            'Csrf::browserOf (HY-24.10)' => ['csrfBrowserOf', ['masked'], 'browser', 'digest'],
            'Context::hash (HY-125.12)' => ['contextHash', ['build', '{}'], 'contextHash', 'hash'],
            'Context::validHeader (HY-127.2)' => ['contextValidHeader', [null], 'validContextHeader', true],
            'the session cookie name (HY-45.1)' => ['sessionCookieName', [true], 'sessionName', '__Host-hy-session'],
            'RepresentationResponse::etag (HY-122.10)' => ['representationEtag', ['application/json', '{}'], 'representationTag', '"tag"'],
            'Request::currentPath (HY-11.4)' => ['requestCurrentPath', ['http://a.test/b?c'], 'currentPath', '/b'],
            'Reply::cacheControl (HY-52.6)' => ['replyCacheControl', ['private'], 'cacheControl', 'private'],
            'Reply::referrerPolicy (HY-103.2)' => ['replyReferrerPolicy', ['origin'], 'referrerPolicy', 'origin'],
            'Reply::status (HY-69)' => ['replyStatus', [403], 'replyStatus', 403],
            'Result::redirect (HY-46)' => ['resultRedirect', ['/list'], 'redirectLocation', '/list'],
            'Result::page (HY-58)' => ['resultPage', [422], 'pageStatus', 422],
            'App::varyHeader (HY-117.1)' => ['appVaryHeader', [true], 'pageVary', 'Accept, HX-Request, HX-Current-URL, Hyper-Context'],
            'the tag of Page::respond (HY-53.1)' => ['pageTag', ['{}', 'masked', self::TOKEN], 'pageTag', 'W/"0"'],
        ];
    }

    /**
     * The partial units, which return the result of their function as it is.
     *
     * @return array<string, array{string, list<mixed>, string, mixed}>
     */
    public static function partialUnits(): array
    {
        return [
            'the session cookie (HY-45.8)' => ['sessionCookieHeader', ['id', true], 'sessionCookie', '__Host-hy-session=id; Path=/; Secure; HttpOnly; SameSite=Lax'],
            'Reply keeps out of shared caches (HY-52.6)' => ['replyKeepsOutOfSharedCaches', ['private'], 'keepsOutOfSharedCaches', true],
            'Result is an application path (HY-46)' => ['resultIsApplicationPath', ['//a'], 'isApplicationPath', false],
            'the path of the static shell (HY-62)' => ['appCheckShellPath', ['/srv/csr/index.html'], 'checkShellPath', null],
            'the text of the static shell (HY-62)' => ['appShellText', ['/srv/csr/index.html', '<html>'], 'shellText', '<html>'],
            'the stored token (HY-24.14)' => ['sessionStoredToken', [self::TOKEN], 'storedToken', self::TOKEN],
            'the name of the kept cookie (HYC-13.6)' => ['keptCookieName', [false], 'keepName', 'hy-keep'],
            'Build::read (HY-125.18)' => ['buildRead', ['{}'], 'readBuild', '1111111111111111111111111111111111111111111111111111111111111111'],
            'the form of a build id (HY-125.19)' => ['buildCheckId', ['1111111111111111111111111111111111111111111111111111111111111111'], 'checkBuildId', null],
        ];
    }

    /** @param list<mixed> $arguments */
    #[DataProvider('exactUnits')]
    #[DataProvider('partialUnits')]
    public function testAUnitCallsItsFunctionWithItsArgumentsAndReturnsItsResult(string $method, array $arguments, string $function, mixed $result): void
    {
        Calls::$results = [$function => $result];
        $rules = new CoreRules(self::STAND_IN);
        self::assertSame($result, $rules->{$method}(...$arguments));
        self::assertSame([[$function, $arguments]], Calls::$calls);
    }

    public function testThereAreFifteenExactUnits(): void
    {
        self::assertCount(15, self::exactUnits());
    }

    public function testTheKeptValueCheckGivesTheFunctionThePagesAndTheFormFields(): void
    {
        // HY-40.1
        $pages = new \stdClass();
        Calls::$results = ['keptValue' => true];
        self::assertTrue((new CoreRules(self::STAND_IN))->appKeptValue($pages, 'rows', 'open', 'true'));
        self::assertSame([['keptValue', [$pages, 'rows', 'open', 'true']]], Calls::$calls);
    }

    public function testTheFrameHeadersAreAMapInTheOrderOfTheCore(): void
    {
        // HY-45.5, HY-65.1
        Calls::$results = ['frameHeaders' => [['Content-Security-Policy', "frame-ancestors 'self'"], ['Cache-Control', 'no-store']]];
        $headers = (new CoreRules(self::STAND_IN))->appFrameHeaders(403, "'self'");
        self::assertSame(['Content-Security-Policy' => "frame-ancestors 'self'", 'Cache-Control' => 'no-store'], $headers);
        self::assertSame([['frameHeaders', [403, "'self'"]]], Calls::$calls);
    }

    public function testAFailureOfTheBindingReachesTheCallerAsTheBindingRaisedIt(): void
    {
        // HY-132.1, HY-132.2; HY-24.14 for a session that holds another value in the place of the token.
        $failure = new \InvalidArgumentException('the session holds a token of another form');
        Calls::$results = ['storedToken' => $failure];
        try {
            (new CoreRules(self::STAND_IN))->sessionStoredToken('conformance-token');
            self::fail('the failure of the binding did not reach the caller');
        } catch (\InvalidArgumentException $raised) {
            self::assertSame($failure, $raised);
        }
    }

    public function testANamespaceWithoutAFunctionOfTheBindingFailsWithTheNamesOfTheFunctions(): void
    {
        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('hyper: the binding of the core has no member ' . implode(', ', CoreRules::MEMBERS));
        new CoreRules('Polyspec\Hyper\Tests\Support\NoBinding');
    }
}
