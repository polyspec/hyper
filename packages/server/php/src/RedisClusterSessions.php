<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server;

/**
 * Keeps the PHP session on Redis Cluster with the protocol of HY-115. The `rediscluster` session handler of phpredis
 * sends GET and SETEX and takes no lock, so concurrent requests of one session would lose updates. Pass this as
 * `sessionSetup` of `App::open`: it installs itself just before a session starts.
 */
final class RedisClusterSessions implements \SessionHandlerInterface, \SessionUpdateTimestampHandlerInterface
{
    private const RELEASE = 'if redis.call("get",KEYS[1]) == ARGV[1] then '
        . 'return redis.call("del",KEYS[1]) else return 0 end';

    private ?\RedisCluster $cluster = null;
    private ?string $lock = null;
    private string $secret = '';

    /**
     * @param list<string> $seeds `host:port` of nodes of the cluster
     * @param int $lockExpire the seconds after which a lock expires, longer than any request
     * @param int $lockRetries how often a request tries a lock that another holds, -1 without an end
     * @param int $lockWait the microseconds between the tries
     * @param float $timeout the seconds to wait for a connection and for a reply
     * @param mixed $auth the password, or the user and the password, of `RedisCluster`
     * @param ?array<string, mixed> $context the stream context of `RedisCluster`, such as `['cafile' => ...]`
     */
    public function __construct(
        private readonly array $seeds,
        private readonly int $lockExpire = 30,
        private readonly int $lockRetries = 100,
        private readonly int $lockWait = 20000,
        private readonly float $timeout = 1.0,
        #[\SensitiveParameter] private readonly mixed $auth = null,
        private readonly ?array $context = null,
    ) {
        ArgumentCount::most(\func_num_args(), 7);
    }

    /** Installs this handler for the session that starts next. */
    public function __invoke(): void
    {
        ArgumentCount::most(\func_num_args(), 0);
        session_set_save_handler($this, false);
    }

    public function open(string $path, string $name): bool
    {
        ArgumentCount::most(\func_num_args(), 2);
        $this->cluster = new \RedisCluster(
            null,
            $this->seeds,
            $this->timeout,
            $this->timeout,
            true,
            $this->auth,
            $this->context,
        );

        return true;
    }

    public function close(): bool
    {
        ArgumentCount::most(\func_num_args(), 0);
        $released = $this->release();
        $this->cluster = null;

        return $released;
    }

    public function validateId(string $id): bool
    {
        ArgumentCount::most(\func_num_args(), 1);
        return $this->connected()->exists(self::key($id)) > 0;
    }

    public function updateTimestamp(string $id, string $data): bool
    {
        ArgumentCount::most(\func_num_args(), 2);
        $this->connected()->expire(self::key($id), self::lifetime());

        return true;
    }

    public function read(string $id): string|false
    {
        ArgumentCount::most(\func_num_args(), 1);
        if (!$this->acquire($id)) {
            trigger_error('hyper: the session lock is taken', E_USER_WARNING);

            return false;
        }
        $record = $this->connected()->get(self::key($id));

        return is_string($record) ? $record : '';
    }

    public function write(string $id, string $data): bool
    {
        ArgumentCount::most(\func_num_args(), 2);
        try {
            if ($this->lock === null || $this->connected()->get($this->lock) !== $this->secret) {
                $this->lock = null;
                trigger_error('hyper: the session lock expired, so the request wrote nothing', E_USER_WARNING);

                return false;
            }

            return $this->connected()->setex(self::key($id), self::lifetime(), $data) === true;
        } catch (\RedisClusterException $failure) {
            trigger_error("hyper: the session was not written: {$failure->getMessage()}", E_USER_WARNING);

            return false;
        }
    }

    public function destroy(string $id): bool
    {
        ArgumentCount::most(\func_num_args(), 1);
        $this->release();
        $this->connected()->del(self::key($id));

        return true;
    }

    public function gc(int $max_lifetime): int
    {
        ArgumentCount::most(\func_num_args(), 1);
        return 0;
    }

    private function acquire(string $id): bool
    {
        if ($this->lock !== null) {
            return true;
        }
        $lock = self::key($id) . '_LOCK';
        $secret = bin2hex(random_bytes(16));
        for ($try = 0; $this->lockRetries === -1 || $try <= $this->lockRetries; $try++) {
            if ($this->connected()->set($lock, $secret, ['NX', 'PX' => $this->lockExpire * 1000]) === true) {
                $this->lock = $lock;
                $this->secret = $secret;

                return true;
            }
            usleep($this->lockWait);
        }

        return false;
    }

    private function release(): bool
    {
        if ($this->lock === null) {
            return true;
        }
        $lock = $this->lock;
        $this->lock = null;
        try {
            $this->connected()->eval(self::RELEASE, [$lock, $this->secret], 1);

            return true;
        } catch (\RedisClusterException $failure) {
            trigger_error("hyper: the session lock was not released: {$failure->getMessage()}", E_USER_WARNING);

            return false;
        }
    }

    private function connected(): \RedisCluster
    {
        return $this->cluster ?? throw new \LogicException('hyper: the session is not open');
    }

    private static function key(string $id): string
    {
        return "PHPREDIS_SESSION:{$id}";
    }

    private static function lifetime(): int
    {
        return (int) ini_get('session.gc_maxlifetime');
    }
}
