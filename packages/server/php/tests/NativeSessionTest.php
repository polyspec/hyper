<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server\Tests;

use PHPUnit\Framework\Attributes\RunInSeparateProcess;
use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\Server\NativeSession;
use Polyspec\Hyper\Server\Request;
use Polyspec\Hyper\Server\Tests\Support\RefusingSessionHandler;

/** HY-45, HY-72, HY-104, HY-129: the PHP session starts only when a request reads or writes session data, under the name that hyper sets. */
final class NativeSessionTest extends TestCase
{
    /** @param array<string, string> $cookies */
    private static function request(array $cookies = [], bool $https = false): Request
    {
        return new Request('GET', '/', cookies: $cookies, https: $https);
    }

    #[RunInSeparateProcess]
    public function testStartsTheSessionOnFirstUse(): void
    {
        $store = new NativeSession(false, self::request());
        self::assertSame(PHP_SESSION_NONE, session_status());

        $store->set('a', 1);
        self::assertSame(PHP_SESSION_ACTIVE, session_status());
        self::assertSame(1, $store->get('a'));
    }

    /** HY-115: the setup runs once just before the session starts, so its settings reach the session. */
    #[RunInSeparateProcess]
    public function testRunsTheSetupJustBeforeTheSessionStarts(): void
    {
        $directory = sys_get_temp_dir();
        $calls = 0;
        $session = new NativeSession(false, self::request(), static function () use (&$calls, $directory): void {
            $calls++;
            self::assertSame(PHP_SESSION_NONE, session_status());
            ini_set('session.save_path', $directory);
        });
        self::assertSame(0, $calls, 'a request that uses no session asks nothing');
        $session->set('a', 1);
        self::assertSame(1, $session->get('a'));
        self::assertSame(1, $calls);
        self::assertSame($directory, session_save_path());
    }

    /** HY-115: a request whose setup fails answers no empty session. */
    #[RunInSeparateProcess]
    public function testAnErrorOfTheSetupFailsTheRequest(): void
    {
        $session = new NativeSession(false, self::request(), static function (): void {
            throw new \RuntimeException('no primary');
        });
        try {
            $session->set('a', 1);
            self::fail('the request went on without its session');
        } catch (\RuntimeException $failure) {
            self::assertSame('no primary', $failure->getMessage());
        }
        self::assertSame(PHP_SESSION_NONE, session_status());
    }

    /** HY-115: phpredis refuses a lock that another request holds, and PHP then starts no session. */
    #[RunInSeparateProcess]
    public function testFailsTheRequestWhenTheSessionCannotStart(): void
    {
        session_set_save_handler(new RefusingSessionHandler(true));
        set_error_handler(static fn (): bool => true);
        try {
            (new NativeSession(false, self::request()))->set('a', 1);
            self::fail('the request went on without its session');
        } catch (\RuntimeException $failure) {
            self::assertSame('hyper: the session could not start', $failure->getMessage());
        } finally {
            restore_error_handler();
        }
    }

    #[RunInSeparateProcess]
    public function testNamesTheCookieHySessionOverHttp(): void
    {
        (new NativeSession(false, self::request()))->set('a', 1);

        self::assertSame('hy-session', session_name());
        self::assertSame(
            ['path' => '/', 'domain' => '', 'secure' => false, 'httponly' => true, 'samesite' => 'Lax'],
            array_intersect_key(
                session_get_cookie_params(),
                array_flip(['path', 'domain', 'secure', 'httponly', 'samesite']),
            ),
        );
    }

    #[RunInSeparateProcess]
    public function testNamesTheCookieWithTheHostPrefixOverHttps(): void
    {
        (new NativeSession(true, self::request()))->set('a', 1);

        self::assertSame('__Host-hy-session', session_name());
        self::assertSame(
            ['path' => '/', 'domain' => '', 'secure' => true],
            array_intersect_key(session_get_cookie_params(), array_flip(['path', 'domain', 'secure'])),
        );
    }

    /** HY-129: a session that the request's cookie names is resumed, and its identifier is not sent again. */
    #[RunInSeparateProcess]
    public function testResumesTheSessionOfTheRequestCookie(): void
    {
        (new NativeSession(false, self::request()))->set('a', 1);
        $identifier = session_id();
        self::assertIsString($identifier);
        session_write_close();

        $store = new NativeSession(false, self::request(['hy-session' => $identifier]));
        self::assertSame(1, $store->get('a'));
        self::assertSame($identifier, session_id());
    }

    /** HY-45: an identifier that the server did not create gives a new session. */
    #[RunInSeparateProcess]
    public function testReplacesAnIdentifierThatTheServerDidNotCreate(): void
    {
        $unknown = str_repeat('a', 26);
        $store = new NativeSession(false, self::request(['hy-session' => $unknown]));

        self::assertNull($store->get('a'));
        self::assertNotSame($unknown, session_id());
    }

    /** HY-45: a cookie value that is not an identifier of the form of HY-45 starts no session with it. */
    #[RunInSeparateProcess]
    public function testIgnoresACookieThatIsNotAnIdentifierOfHySession(): void
    {
        $store = new NativeSession(false, self::request(['hy-session' => 'short']));
        $store->set('a', 1);

        self::assertNotSame('short', session_id());
    }

    #[RunInSeparateProcess]
    public function testRenewsTheIdentifierAndKeepsTheValues(): void
    {
        $store = new NativeSession(false, self::request());
        $store->set('a', 1);
        $old = session_id();

        $store->renew();

        self::assertNotSame($old, session_id());
        self::assertSame(1, $store->get('a'));
    }

    /** HY-104: the lock of the session file serializes the requests of one session, so no update is lost. */
    public function testProcessesThatWriteOneSessionLoseNoUpdate(): void
    {
        $directory = sys_get_temp_dir() . '/hyper-session-' . bin2hex(random_bytes(6));
        mkdir($directory);
        try {
            $created = self::writers($directory, null, 1);
            $identifier = $created[0];
            self::writers($directory, $identifier, 4);

            self::assertSame('a:1:{s:1:"n";i:5;}', (string) file_get_contents("{$directory}/sess_{$identifier}"));
        } finally {
            array_map('unlink', glob("{$directory}/*") ?: []);
            rmdir($directory);
        }
    }

    /**
     * Runs `$count` processes of the session writer at the same time and returns the session identifier that each
     * printed.
     *
     * @return list<string>
     */
    private static function writers(string $directory, ?string $identifier, int $count): array
    {
        $env = [...getenv(), 'HYPER_SESSION_DIRECTORY' => $directory];
        if ($identifier !== null) {
            $env['HYPER_SESSION_ID'] = $identifier;
        }
        $processes = [];
        for ($index = 0; $index < $count; $index++) {
            $process = proc_open(
                [PHP_BINARY, __DIR__ . '/Support/session-writer.php'],
                [0 => ['file', '/dev/null', 'r'], 1 => ['pipe', 'w'], 2 => ['file', '/dev/null', 'w']],
                $pipes,
                null,
                $env,
            );
            self::assertIsResource($process);
            $processes[] = [$process, $pipes[1]];
        }
        $identifiers = [];
        foreach ($processes as [$process, $output]) {
            $identifiers[] = (string) stream_get_contents($output);
            fclose($output);
            proc_close($process);
        }

        return $identifiers;
    }
}
