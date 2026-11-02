// Sessions in files of one absolute directory, for a server process (HY-45).
import { randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { deserialize, serialize } from 'node:v8';
import { lock, lockSync, type LockOptions } from 'proper-lockfile';
import { errorCode } from './error-code.js';
import type { SessionStore } from './session.js';

export interface FileSessionsOptions {
  // An existing absolute directory; the server processes that share it share its sessions (HY-104).
  directory: string;
  // Seconds after the last request of a session until the session ends; PHP's session.gc_maxlifetime is 1440.
  lifetime?: number;
}

const IDENTIFIER = /^[0-9a-f]{64}$/;
// The milliseconds after the last refresh of a lock directory until another process may take the lock (HY-104).
const STALE = 10_000;

// A lock that its holder lost, because another process took it after it had not been refreshed for STALE milliseconds.
interface Lost {
  error: Error | null;
}

// Opens one session store per request. A session file is named by its identifier, so the server accepts only
// identifiers that it created: a cookie value that is not 64 lowercase hexadecimal digits or has no unexpired
// file starts a new session. The session starts on the first read or write, so a request that never uses it
// creates no session. Requests of one session run one after another, because each one reads the file when it
// starts and writes it when it ends, and holds the lock of the session in between: a queue orders the requests of
// this process and the lock directory `<id>.lock` those of every process of the directory (HY-104). The holder
// refreshes the modification time of the lock directory while it holds it, so the lock of a process that ended
// without releasing it counts as released once it has not been refreshed for STALE milliseconds.
export class FileSessions {
  /** @internal */
  readonly directory: string;
  /** @internal */
  readonly lifetime: number;
  private readonly queues = new Map<string, Promise<void>>();

  constructor(options: FileSessionsOptions) {
    if (!isAbsolute(options.directory) || !statSync(options.directory).isDirectory()) {
      throw new Error(`hyper: session directory ${options.directory} must be an existing absolute directory`);
    }
    const lifetime = options.lifetime ?? 1440;
    if (!Number.isSafeInteger(lifetime) || lifetime <= 0) throw new Error('hyper: session lifetime must be a positive number of seconds');
    this.directory = options.directory;
    this.lifetime = lifetime;
  }

  // Opens the store of a request with the value of its session cookie, after the earlier requests of the same
  // session have ended. The caller calls `close` of the store when the response is complete.
  /** @internal */
  async open(cookie: string | null): Promise<FileSession> {
    const id = cookie !== null && IDENTIFIER.test(cookie) ? cookie : null;
    if (id === null) return new FileSession(this, null, { error: null }, async () => {});
    const previous = this.queues.get(id) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.queues.set(id, queued);
    await previous;
    const leave = () => {
      release();
      if (this.queues.get(id) === queued) this.queues.delete(id);
    };
    const lost: Lost = { error: null };
    let unlock: () => Promise<void>;
    try {
      unlock = await lock(join(this.directory, id), {
        ...this.lockOptions(id),
        retries: { forever: true, factor: 1.5, minTimeout: 5, maxTimeout: 100 },
        onCompromised: (error) => {
          lost.error = error;
        },
      });
    } catch (error) {
      leave();
      throw error;
    }
    return new FileSession(this, id, lost, async () => {
      try {
        // proper-lockfile has released a lock that it lost.
        if (lost.error === null) await unlock();
      } finally {
        leave();
      }
    });
  }

  // The lock of the session of an identifier: the directory `<id>.lock` beside its session file, which need not exist.
  private lockOptions(id: string): LockOptions {
    return { realpath: false, lockfilePath: join(this.directory, `${id}.lock`), stale: STALE };
  }

  // Removes the files of sessions whose lifetime has passed and returns how many it removed. It skips a session whose
  // lock a request holds.
  /** @internal */
  collect(): number {
    let removed = 0;
    for (const name of readdirSync(this.directory)) {
      if (!IDENTIFIER.test(name) || !this.ended(name)) continue;
      let unlock: () => void;
      try {
        unlock = lockSync(join(this.directory, name), this.lockOptions(name));
      } catch (error) {
        if (errorCode(error) === 'ELOCKED') continue;
        throw error;
      }
      try {
        if (this.ended(name)) {
          unlinkSync(join(this.directory, name));
          removed++;
        }
      } finally {
        unlock();
      }
    }
    return removed;
  }

  // Returns true when the session of an identifier has a file that is older than the lifetime; another process may have
  // removed it.
  private ended(id: string): boolean {
    try {
      return this.expired(join(this.directory, id));
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return false;
      throw error;
    }
  }

  // Returns true when a session file is older than the lifetime.
  /** @internal */
  expired(file: string): boolean {
    return Date.now() - statSync(file).mtimeMs > this.lifetime * 1000;
  }

  // Returns the session cookie name: `__Host-hy-session` over HTTPS and `hy-session` otherwise (HY-45).
  /** @internal */
  static cookieName(secure: boolean): string {
    return secure ? '__Host-hy-session' : 'hy-session';
  }

  // Returns the Set-Cookie value of a new session, with the attributes of the PHP session cookie (HY-45).
  /** @internal */
  cookie(id: string, secure: boolean): string {
    return `${FileSessions.cookieName(secure)}=${id}; path=/${secure ? '; secure' : ''}; HttpOnly; SameSite=Lax`;
  }
}

// The session store of one request.
export class FileSession implements SessionStore {
  private values: Map<string, unknown> | null = null;
  private id: string | null = null;
  private createdId = false;
  private renewedId: string | null = null;
  private readonly sessions: FileSessions;
  private readonly cookieId: string | null;
  private readonly lost: Lost;
  private readonly release: () => Promise<void>;

  constructor(sessions: FileSessions, cookieId: string | null, lost: Lost, release: () => Promise<void>) {
    this.sessions = sessions;
    this.cookieId = cookieId;
    this.lost = lost;
    this.release = release;
  }

  // True when the request read or wrote session data.
  /** @internal */
  get started(): boolean {
    return this.values !== null;
  }

  // The identifier that this request created, which the response sets as the session cookie, or null.
  /** @internal */
  get created(): string | null {
    return this.createdId ? this.id : null;
  }

  get(key: string): unknown {
    return this.start().get(key);
  }

  set(key: string, value: unknown): void {
    this.start().set(key, value);
  }

  remove(key: string): void {
    this.start().delete(key);
  }

  // Gives the values a new identifier, which the response sets as the session cookie; closing deletes the file of the
  // old identifier (HY-72).
  renew(): void {
    this.start();
    if (!this.createdId) this.renewedId = this.id;
    this.id = randomBytes(32).toString('hex');
    this.createdId = true;
  }

  // Writes a started session to its file, removes the file of a renewed identifier, and lets the next request of the
  // session start. A request that lost the lock of its session writes nothing and fails with the error of the loss.
  /** @internal */
  async close(): Promise<void> {
    try {
      if (this.lost.error !== null) throw this.lost.error;
      if (this.renewedId !== null) rmSync(join(this.sessions.directory, this.renewedId), { force: true });
      if (this.values !== null && this.id !== null) {
        const file = join(this.sessions.directory, this.id);
        // Each write has its own temporary file, created exclusively, so two writers of one session never share a
        // name (HY-104). One rename publishes the file (HR-82).
        const writing = `${file}.${randomUUID()}.tmp`;
        try {
          writeFileSync(writing, serialize(this.values), { mode: 0o600, flag: 'wx' });
          renameSync(writing, file);
        } catch (error) {
          rmSync(writing, { force: true });
          throw error;
        }
      }
    } finally {
      await this.release();
    }
  }

  private start(): Map<string, unknown> {
    if (this.values !== null) return this.values;
    if (this.cookieId !== null) {
      const file = join(this.sessions.directory, this.cookieId);
      let content: Buffer | null = null;
      try {
        content = this.sessions.expired(file) ? null : readFileSync(file);
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error;
      }
      if (content !== null) {
        this.id = this.cookieId;
        const stored: unknown = deserialize(content);
        if (!(stored instanceof Map)) throw new Error(`hyper: session file ${file} holds no map of values`);
        const values = new Map<string, unknown>();
        for (const [key, item] of stored) {
          if (typeof key !== 'string') throw new Error(`hyper: session file ${file} holds a key that is not a string`);
          values.set(key, item);
        }
        this.values = values;
        return this.values;
      }
    }
    this.id = randomBytes(32).toString('hex');
    this.createdId = true;
    this.values = new Map();
    return this.values;
  }
}
