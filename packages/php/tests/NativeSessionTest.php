<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\Attributes\RunInSeparateProcess;
use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\NativeSession;
use Polyspec\Hyper\RecordError;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Tests\Support\PhpSessionIdentifier;
use Polyspec\Hyper\Tests\Support\RefusingSessionHandler;
use Polyspec\SessionStore\SessionStoreIoError;
use Polyspec\SessionStore\SessionStoreValueError;

/** HY-45, HY-72, HY-104, HY-129: the PHP session starts only when a request reads or writes session data, under the name that hyper sets. */
final class NativeSessionTest extends TestCase
{
    /** @param array<string, string> $cookies */
    private static function request(array $cookies = [], bool $https = false): Request
    {
        return new Request('GET', '/', cookies: $cookies, https: $https);
    }

    /**
     * HY-104.42, HY-104.43: a new and a regenerated identifier are those of the PHP runtime, of the length and the
     * alphabet of its settings, within the 22 to 256 characters that every server accepts; files handler of PHP.
     */
    #[RunInSeparateProcess]
    public function testCreatesTheIdentifiersOfThePhpRuntime(): void
    {
        ini_set('session.save_path', sys_get_temp_dir());
        $form = '/^' . PhpSessionIdentifier::pattern() . '$/D';
        $store = new NativeSession(false, self::request());
        $store->set('a', 1);
        self::assertMatchesRegularExpression($form, (string) session_id());
        $store->renew();
        self::assertMatchesRegularExpression($form, (string) session_id());
    }

    /**
     * HY-45, HY-104.43: the strict mode of PHP refuses an identifier that the store does not hold, and the identifier
     * that replaces it is one of the PHP runtime; files handler of PHP.
     */
    #[RunInSeparateProcess]
    public function testReplacesAnUnknownIdentifierWithOneOfThePhpRuntime(): void
    {
        ini_set('session.save_path', sys_get_temp_dir());
        $unknown = str_repeat('b', 64);
        $store = new NativeSession(false, self::request(['hy-session' => $unknown]));
        $store->set('a', 1);
        self::assertNotSame($unknown, session_id());
        self::assertMatchesRegularExpression('/^' . PhpSessionIdentifier::pattern() . '$/D', (string) session_id());
    }

    /** HY-104.41: a record that holds an object of a class other than stdClass fails, at any depth, as in the other servers. */
    #[RunInSeparateProcess]
    public function testAnObjectOfAnotherClassFailsWithKindRecord(): void
    {
        $store = new NativeSession(false, self::request());
        $store->set('map', (object) ['a' => 1]);
        self::assertEquals((object) ['a' => 1], $store->get('map'));
        foreach (['top' => new \ArrayObject(), 'nested' => ['x' => [new \DateTimeImmutable('@0')]]] as $key => $value) {
            $store->set($key, $value);
            try {
                $store->get($key);
                self::fail("the object of {$key} was read");
            } catch (RecordError $failure) {
                self::assertSame('record', $failure->kind());
            }
        }
    }

    /** Makes an empty directory of session files, which `removeDirectory` removes. */
    private static function sessionDirectory(): string
    {
        $directory = sys_get_temp_dir() . '/hyper-collect-' . bin2hex(random_bytes(8));
        self::assertTrue(mkdir($directory, 0700));

        return $directory;
    }

    private static function removeDirectory(string $directory): void
    {
        chmod($directory, 0700);
        foreach (glob($directory . '/*') ?: [] as $file) {
            unlink($file);
        }
        rmdir($directory);
    }

    /**
     * HY-104.33, SF-5: `collect` removes the session files of the save path whose lifetime has passed, keeps a file
     * within its lifetime, and returns how many it removed.
     */
    #[RunInSeparateProcess]
    public function testCollectRemovesTheExpiredSessionsOfTheSavePath(): void
    {
        $directory = self::sessionDirectory();
        try {
            $expired = $directory . '/sess_' . str_repeat('a', 26);
            $current = $directory . '/sess_' . str_repeat('b', 26);
            file_put_contents($expired, 'a:0:{}');
            file_put_contents($current, 'a:0:{}');
            touch($expired, time() - 3600);
            ini_set('session.save_path', $directory);
            ini_set('session.gc_maxlifetime', '60');

            self::assertSame(1, NativeSession::collect());
            self::assertFileDoesNotExist($expired);
            self::assertFileExists($current);
        } finally {
            self::removeDirectory($directory);
        }
    }

    /** HY-104.33, SF-9.2: a save path that cannot be read fails `collect` with the Io error of session-store. */
    #[RunInSeparateProcess]
    public function testCollectFailsWithTheIoErrorForAnUnreadableSavePath(): void
    {
        $directory = self::sessionDirectory();
        try {
            chmod($directory, 0000);
            clearstatcache();
            self::assertFalse(is_readable($directory), "the test needs a directory that it cannot read, and {$directory} with mode 0000 is readable to this user");
            ini_set('session.save_path', $directory);
            ini_set('session.gc_maxlifetime', '60');

            try {
                NativeSession::collect();
                self::fail('collect read a directory that it cannot read');
            } catch (SessionStoreIoError $error) {
                self::assertSame('permission_denied', $error->kind());
            }
        } finally {
            self::removeDirectory($directory);
        }
    }

    /**
     * HY-104.33, SF-1.2: a save path `N;/path` with a depth above 0 keeps the files in subdirectories, which the store
     * of session-store does not walk, so `collect` fails with `invalid_directory` and names the save path instead of
     * removing nothing. The depth is read as the native files handler reads it.
     */
    #[RunInSeparateProcess]
    public function testCollectFailsForASavePathWithSubdirectories(): void
    {
        $directory = self::sessionDirectory();
        try {
            ini_set('session.save_path', "2;{$directory}");
            ini_set('session.gc_maxlifetime', '60');

            try {
                NativeSession::collect();
                self::fail('collect accepted a save path with a depth of 2');
            } catch (SessionStoreValueError $error) {
                self::assertSame('invalid_directory', $error->kind());
                self::assertStringContainsString("2;{$directory}", $error->getMessage());
            }
        } finally {
            self::removeDirectory($directory);
        }
    }

    /** HY-104.33: a save path `0;MODE;/path` keeps the files in `/path` itself, so `collect` removes them there. */
    #[RunInSeparateProcess]
    public function testCollectReadsThePathOfASavePathWithDepthZeroAndAMode(): void
    {
        $directory = self::sessionDirectory();
        try {
            $expired = $directory . '/sess_' . str_repeat('c', 26);
            file_put_contents($expired, 'a:0:{}');
            touch($expired, time() - 3600);
            ini_set('session.save_path', "0;600;{$directory}");
            ini_set('session.gc_maxlifetime', '60');

            self::assertSame(1, NativeSession::collect());
            self::assertFileDoesNotExist($expired);
        } finally {
            self::removeDirectory($directory);
        }
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
