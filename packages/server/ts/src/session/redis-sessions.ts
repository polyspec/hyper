// Sessions in a Redis server, with the protocol of phpredis 6.3.0, for a server process (HY-115).
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { RedisSession } from './redis-session.js';
import { RecordSession } from './record-session.js';
import { SessionLockError } from './session-lock-error.js';
import { SessionTurns } from './session-turns.js';
import { ArgumentCountError } from '../app/argument-count-error.js';

// One command of a Redis server: its words, and its reply with a bulk string as bytes. With node-redis:
// (words) => client.withTypeMapping({ [RESP_TYPES.BLOB_STRING]: Buffer }).sendCommand(words.map((word) => Buffer.from(word)))
export type RedisCommand = (words: (string | Uint8Array)[]) => Promise<unknown>;

export interface RedisSessionsOptions {
  // Runs a command on the Redis server that the server processes share.
  command: RedisCommand;
  // Seconds after the last request of a session until the session ends; PHP's session.gc_maxlifetime is 1440.
  lifetime?: number;
  // The prefix of the keys; the `prefix` of session.save_path of phpredis.
  prefix?: string;
  // Seconds until a lock expires, longer than any request; redis.session.lock_expire of phpredis.
  lockExpire?: number;
  // How many more times a request tries a lock that another holds; redis.session.lock_retries of phpredis.
  lockRetries?: number;
  // Milliseconds between two tries; redis.session.lock_wait_time of phpredis, in microseconds there.
  lockWait?: number;
}

// The names of the options of the store, the members of its options record (HY-106.9).
const REDIS_SESSIONS_REQUIRED = ['command'];
const REDIS_SESSIONS_OPTIONAL = ['lifetime', 'prefix', 'lockExpire', 'lockRetries', 'lockWait'];
const RELEASE = 'if redis.call("get",KEYS[1]) == ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end';

// Opens one session store per request. A session is the key `PHPREDIS_SESSION:<id>`, whose bytes are the php_serialize
// record of its values and which expires after the lifetime, so the PHP, Node and Python servers that share the Redis
// server share its sessions. A request holds the lock `<key>_LOCK`, which SET NX PX takes, from its opening to its closing,
// so the requests of one session run one after another in every process. A lock expires, so a holder checks it before it
// writes and writes nothing when it lost it. Every server of one Redis server gives the lock options the same values.
export class RedisSessions {
  /** @internal */
  readonly command: RedisCommand;
  /** @internal */
  readonly lifetime: number;
  private readonly prefix: string;
  private readonly lockExpire: number;
  private readonly lockRetries: number;
  private readonly lockWait: number;
  /** @internal */
  readonly turns: SessionTurns;

  constructor(options: RedisSessionsOptions) {
    ArgumentCountError.between(arguments.length, 1, 1);
    ArgumentCountError.members(options, REDIS_SESSIONS_REQUIRED, REDIS_SESSIONS_OPTIONAL);
    this.turns = new SessionTurns();
    const lifetime = options.lifetime ?? 1440;
    if (!Number.isSafeInteger(lifetime) || lifetime <= 0) throw new Error('hyper: session lifetime must be a positive number of seconds');
    const lockExpire = options.lockExpire ?? 30;
    if (!Number.isSafeInteger(lockExpire) || lockExpire <= 0) throw new Error('hyper: session lockExpire must be a positive number of seconds');
    this.command = options.command;
    this.lifetime = lifetime;
    this.prefix = options.prefix ?? 'PHPREDIS_SESSION:';
    this.lockExpire = lockExpire;
    this.lockRetries = options.lockRetries ?? 100;
    this.lockWait = options.lockWait ?? 20;
  }

  /** @internal */
  async open(cookie: string | null): Promise<RedisSession> {
    const id = RecordSession.accepted(cookie);
    if (id === null) return new RedisSession(this, null, null, null);
    await this.turns.enter(id);
    try {
      const key = this.key(id);
      if ((await this.command(['EXISTS', key])) !== 1) {
        this.turns.leave(id);
        return new RedisSession(this, null, null, null);
      }
      const secret = await this.takeLock(key);
      try {
        const record = RedisSessions.bulkBytes(await this.command(['GET', key]));
        if (record === null) {
          await this.release(key, secret);
          this.turns.leave(id);
          return new RedisSession(this, null, null, null);
        }
        return new RedisSession(this, id, secret, record);
      } catch (error) {
        await this.release(key, secret);
        throw error;
      }
    } catch (error) {
      this.turns.leave(id);
      throw error;
    }
  }

  /** @internal */
  key(id: string): string {
    return `${this.prefix}${id}`;
  }

  /** @internal */
  async holds(key: string, secret: string): Promise<boolean> {
    const held = RedisSessions.bulkBytes(await this.command(['GET', `${key}_LOCK`]));
    return held !== null && Buffer.from(held).toString() === secret;
  }

  /** @internal */
  async release(key: string, secret: string): Promise<void> {
    await this.command(['EVAL', RELEASE, '1', `${key}_LOCK`, secret]);
  }

  // Takes the lock of a session and returns its secret. Each lock has a secret of its own, so a request of this process
  // cannot release the lock that another request of it took after its own expired.
  private async takeLock(key: string): Promise<string> {
    const secret = `${hostname()}|${String(process.pid)}|${randomBytes(8).toString('hex')}`;
    for (let attempt = 0; attempt <= this.lockRetries; attempt++) {
      if ((await this.command(['SET', `${key}_LOCK`, secret, 'NX', 'PX', String(this.lockExpire * 1000)])) !== null) return secret;
      if (attempt < this.lockRetries) await delay(this.lockWait);
    }
    throw new SessionLockError(`hyper: the lock of the session ${key} was not free`);
  }

  // Returns a reply of a bulk string as bytes, or null. A client that returns text would change the bytes of a record.
  private static bulkBytes(reply: unknown): Uint8Array | null {
    if (reply === null || reply instanceof Uint8Array) return reply;
    throw new TypeError('hyper: the Redis command must return a bulk string as bytes');
  }
}
