<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The session setup of `App::open` that keeps the PHP session on the primary that Redis Sentinel names (HY-115).
 * The session handler of phpredis connects to the address of `session.save_path` and does not know Sentinel, so this
 * asks Sentinel just before a session starts and sets that address; phpredis keeps its locks, and a request without a
 * session asks nothing.
 */
final class RedisSentinelSessions
{
    /**
     * @param list<array<string, mixed>> $sentinels the options of `RedisSentinel` for each Sentinel, asked one after
     *     another: `host`, `port` and, as they apply, `auth` and `ssl`
     * @param string $service the name of the primary that the Sentinels monitor
     * @param string $parameters the parameters of `session.save_path`, such as `?auth[]=user&auth[]=secret`
     * @param string $scheme `tcp` or `tls`
     * @param float $timeout the seconds to wait for each Sentinel
     */
    public function __construct(
        private readonly array $sentinels,
        private readonly string $service,
        private readonly string $parameters = '',
        private readonly string $scheme = 'tcp',
        private readonly float $timeout = 0.5,
    ) {
    }

    /** Sets `session.save_path` to the primary; when no Sentinel names it, the request fails. */
    public function __invoke(): void
    {
        foreach ($this->sentinels as $sentinel) {
            $address = $this->asked($sentinel);
            if ($address !== null) {
                ini_set('session.save_path', "{$this->scheme}://{$address}{$this->parameters}");

                return;
            }
        }
        throw new \RuntimeException("hyper: no Sentinel names the primary {$this->service}");
    }

    /**
     * Returns `host:port` of the primary that a Sentinel names, or null when it cannot answer.
     *
     * @param array<string, mixed> $sentinel
     */
    private function asked(array $sentinel): ?string
    {
        try {
            $client = new \RedisSentinel([
                'connectTimeout' => $this->timeout,
                'readTimeout' => $this->timeout,
                ...$sentinel,
            ]);
            $address = $client->getMasterAddrByName($this->service);
        } catch (\RedisException | \ErrorException) {
            return null;
        }

        if (!is_array($address)) {
            return null;
        }
        [$host, $port] = [$address[0] ?? null, $address[1] ?? null];

        return is_string($host) && is_string($port) ? "{$host}:{$port}" : null;
    }
}
