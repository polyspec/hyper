// Sessions in a Redis server, a Redis Sentinel group or a Redis Cluster, in the form of phpredis 6.3.0, for a server
// process (HY-115): the Redis store of the session-store library, whose rule the storage of a session is.
import { RedisSessions as LibraryRedisSessions, type Setting } from '@polyspec/session-store';
import { FileSession } from './file-session.js';
import { RedisSession } from './redis-session.js';
import { ArgumentCountError } from '../app/argument-count-error.js';

// The connection settings of the store (HY-115.17, HY-115.29): `{ kind: 'server', url, authorities }` with a URL
// `redis://` or `rediss://` that may name an ACL user and its password, `{ kind: 'sentinel', urls, service, tls, user,
// password, authorities }`, whose store asks the Sentinels for the primary of `service` before each request that has a
// session (HY-115.26), or `{ kind: 'cluster', urls, user, password, authorities }`, whose `user` and `password` are null where the URLs
// give the credentials. `authorities` is the path of a PEM file whose
// authorities alone verify the servers of TLS, or null for the trust store of the machine.
export type RedisSetting = Setting;

export interface RedisSessionsOptions {
  // The addresses, TLS and the ACL user of the Redis server; the store keeps its own connections.
  setting: RedisSetting;
  // Seconds until a lock expires, longer than any request; redis.session.lock_expire of phpredis. It has no default,
  // because no value is longer than every request of every application (HY-115.28).
  lockExpire: number;
  // Seconds after the last request of a session until the session ends; PHP's session.gc_maxlifetime is 1440.
  lifetime?: number;
  // The prefix of the keys; the `prefix` of session.save_path of phpredis. Its default is `PHPREDIS_SESSION:`.
  prefix?: string;
  // How many more times a request tries a lock that another holds; redis.session.lock_retries of phpredis, 100.
  lockRetries?: number;
  // Microseconds between two tries; redis.session.lock_wait_time of phpredis, 20000.
  lockWait?: number;
}

// The names of the options of the store, the members of its options record (HY-106.9).
const REDIS_SESSIONS_REQUIRED = ['setting', 'lockExpire'];
const REDIS_SESSIONS_OPTIONAL = ['lifetime', 'prefix', 'lockRetries', 'lockWait'];

// Opens one session store per request. A session is the key `<prefix><id>`, whose bytes are the php_serialize record of
// its values and which expires after the lifetime, so the PHP, Node and Python servers that share the Redis server share
// its sessions. A request holds the lock `<key>_LOCK` from its opening to its closing, so the requests of one session run
// one after another in every process (HY-115.3); a holder that lost its lock writes nothing (HY-115.5). A failure of the
// library is an error of hyper of the same category with the kind of the library (HY-133.3): a lifetime or a lock
// expiry of 0 fails with `invalid_lifetime` or `invalid_lock_expire`, a lock whose tries end with `lock_timeout` and a
// lost lock with `lock_lost`.
export class RedisSessions {
  private readonly store: LibraryRedisSessions;

  constructor(options: RedisSessionsOptions) {
    ArgumentCountError.between(arguments.length, 1, 1);
    ArgumentCountError.members(options, REDIS_SESSIONS_REQUIRED, REDIS_SESSIONS_OPTIONAL);
    const { setting, ...rest } = options;
    this.store = FileSession.converted(() => new LibraryRedisSessions(setting, rest));
  }

  // Opens the store of a request with the value of its session cookie; it holds the lock of the session until `close`.
  /** @internal */
  async open(cookie: string | null): Promise<RedisSession> {
    return new RedisSession(await FileSession.awaited(() => this.store.open(cookie)));
  }
}
