<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server\Tests;

use PHPUnit\Framework\TestCase;

/**
 * HY-45, HY-129: the session cookie that the server sends over HTTP, through the PHP built-in server. PHP sends no
 * cookie for the session, so these checks read the `Set-Cookie` lines of the responses.
 */
final class SessionCookieTest extends TestCase
{
    private const string PAGE = __DIR__ . '/Support/session-cookie.php';

    /** @var resource|null */
    private $server = null;

    private ?int $port = null;

    private string $directory = '';

    private int $status = 0;

    protected function setUp(): void
    {
        $this->directory = sys_get_temp_dir() . '/hyper-session-cookie-' . bin2hex(random_bytes(6));
        mkdir($this->directory);
        $server = proc_open(
            [
                PHP_BINARY,
                '-d',
                'display_errors=0',
                '-d',
                'error_log=/dev/null',
                '-d',
                "session.save_path={$this->directory}",
                '-S',
                '127.0.0.1:0',
                self::PAGE,
            ],
            [0 => ['file', '/dev/null', 'r'], 1 => ['file', '/dev/null', 'w'], 2 => ['pipe', 'w']],
            $pipes,
            null,
            getenv(),
        );
        self::assertIsResource($server, 'the PHP built-in server did not start');
        $this->server = $server;
        // The server reports its address on its standard error when it listens; a closed pipe means it stopped.
        do {
            $line = fgets($pipes[2]);
            self::assertIsString($line, 'the PHP built-in server stopped before it listened');
        } while (preg_match('/\(http:\/\/127\.0\.0\.1:(\d+)\) started/', $line, $address) !== 1);
        $this->port = (int) $address[1];
        fclose($pipes[2]);
    }

    protected function tearDown(): void
    {
        if (is_resource($this->server)) {
            proc_terminate($this->server);
            proc_close($this->server);
        }
        array_map('unlink', glob("{$this->directory}/*") ?: []);
        rmdir($this->directory);
    }

    /**
     * Requests the page with `$query` and an optional `Cookie` header, and returns its `Set-Cookie` lines and its body.
     *
     * @return array{list<string>, string}
     */
    private function request(string $query, ?string $cookie = null): array
    {
        $context = stream_context_create(['http' => [
            'ignore_errors' => true,
            'header' => $cookie === null ? [] : ["Cookie: {$cookie}"],
        ]]);
        $stream = fopen("http://127.0.0.1:{$this->port}/?{$query}", 'r', false, $context);
        if ($stream === false) {
            self::fail('the PHP built-in server gave no response');
        }
        $body = (string) stream_get_contents($stream);
        $lines = stream_get_meta_data($stream)['wrapper_data'] ?? [];
        fclose($stream);
        self::assertIsArray($lines);
        self::assertIsString($lines[0] ?? null);
        $this->status = (int) explode(' ', $lines[0])[1];
        $setCookies = [];
        foreach ($lines as $line) {
            self::assertIsString($line);
            if (stripos($line, 'Set-Cookie:') === 0) {
                $setCookies[] = $line;
            }
        }

        return [$setCookies, $body];
    }

    public function testSendsTheCookieOfANewSession(): void
    {
        [$setCookies, $id] = $this->request('mode=write');

        self::assertCount(1, $setCookies);
        self::assertSame("Set-Cookie: hy-session={$id}; path=/; HttpOnly; SameSite=Lax", $setCookies[0]);
        self::assertMatchesRegularExpression('/^[A-Za-z0-9,-]{22,128}$/D', $id);
    }

    public function testSendsTheHostPrefixedCookieWithSecureOverHttps(): void
    {
        [$setCookies, $id] = $this->request('mode=write&https=1');

        self::assertCount(1, $setCookies);
        self::assertSame("Set-Cookie: __Host-hy-session={$id}; path=/; secure; HttpOnly; SameSite=Lax", $setCookies[0]);
    }

    /** HY-129: a session that the request's cookie names is resumed, and its identifier is not sent again. */
    public function testSendsNoCookieForTheSessionOfTheRequest(): void
    {
        [, $id] = $this->request('mode=write');

        [$setCookies, $resumed] = $this->request('mode=read', "hy-session={$id}");

        self::assertSame([], $setCookies);
        self::assertSame($id, $resumed);
    }

    /** HY-45: an identifier that the server did not create is replaced, and the new identifier is sent. */
    public function testSendsTheCookieOfTheSessionThatReplacesAnUnknownIdentifier(): void
    {
        $unknown = str_repeat('a', 26);

        [$setCookies, $id] = $this->request('mode=read', "hy-session={$unknown}");

        self::assertNotSame($unknown, $id);
        self::assertSame(["Set-Cookie: hy-session={$id}; path=/; HttpOnly; SameSite=Lax"], $setCookies);
    }

    /** HY-129: a regenerated identifier is sent, so the client holds the identifier that the server keeps. */
    public function testSendsTheCookieOfARegeneratedIdentifier(): void
    {
        [, $old] = $this->request('mode=write');

        [$setCookies, $new] = $this->request('mode=renew', "hy-session={$old}");

        self::assertNotSame($old, $new);
        self::assertSame(["Set-Cookie: hy-session={$new}; path=/; HttpOnly; SameSite=Lax"], $setCookies);
    }

    /** HY-115, HY-129: a start that fails answers status 500 and sends no session cookie. */
    public function testSendsNoCookieWhenTheSessionCannotStart(): void
    {
        [$setCookies, $body] = $this->request('mode=fail');

        self::assertSame(500, $this->status);
        self::assertSame([], $setCookies);
        self::assertSame('', $body);
    }
}
