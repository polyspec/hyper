<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\Attributes\RunInSeparateProcess;
use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\NativeSession;

/** HY-45, HY-72, HY-104: the PHP session starts only when a request reads or writes session data, under the name that hyper sets. */
final class NativeSessionTest extends TestCase
{
    #[RunInSeparateProcess]
    public function testStartsTheSessionOnFirstUse(): void
    {
        $store = new NativeSession(false);
        self::assertSame(PHP_SESSION_NONE, session_status());

        $store->set('a', 1);
        self::assertSame(PHP_SESSION_ACTIVE, session_status());
        self::assertSame(1, $store->get('a'));
    }

    #[RunInSeparateProcess]
    public function testNamesTheCookieHySessionOverHttp(): void
    {
        (new NativeSession(false))->set('a', 1);

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
        (new NativeSession(true))->set('a', 1);

        self::assertSame('__Host-hy-session', session_name());
        self::assertSame(
            ['path' => '/', 'domain' => '', 'secure' => true],
            array_intersect_key(session_get_cookie_params(), array_flip(['path', 'domain', 'secure'])),
        );
    }

    #[RunInSeparateProcess]
    public function testRenewsTheIdentifierAndKeepsTheValues(): void
    {
        $store = new NativeSession(false);
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

            self::assertStringContainsString('n|i:5;', (string) file_get_contents("{$directory}/sess_{$identifier}"));
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
