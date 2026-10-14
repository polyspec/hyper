// Sessions in files of one absolute directory, for a server process (HY-45).
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { deserialize, serialize } from 'node:v8';
import type { SessionStore } from './session.js';

export interface FileSessionsOptions {
  // An existing absolute directory that only this server process writes.
  directory: string;
  // Seconds after the last request of a session until the session ends; PHP's session.gc_maxlifetime is 1440.
  lifetime?: number;
}

const IDENTIFIER = /^[0-9a-f]{64}$/;

// Opens one session store per request. A session file is named by its identifier, so the server accepts only
// identifiers that it created: a cookie value that is not 64 lowercase hexadecimal digits or has no unexpired
// file starts a new session. The session starts on the first read or write, so a request that never uses it
// creates no session. Requests of one session run one after another, because each one reads the file when it
// starts and writes it when it ends.
export class FileSessions {
  readonly directory: string;
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
  async open(cookie: string | null): Promise<FileSession> {
    const id = cookie !== null && IDENTIFIER.test(cookie) ? cookie : null;
    if (id === null) return new FileSession(this, null, () => {});
    const previous = this.queues.get(id) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.queues.set(id, queued);
    await previous;
    return new FileSession(this, id, () => {
      release();
      if (this.queues.get(id) === queued) this.queues.delete(id);
    });
  }

  // Removes the files of sessions whose lifetime has passed and returns how many it removed.
  collect(): number {
    let removed = 0;
    for (const name of readdirSync(this.directory)) {
      if (IDENTIFIER.test(name) && this.expired(join(this.directory, name))) {
        unlinkSync(join(this.directory, name));
        removed++;
      }
    }
    return removed;
  }

  // Returns true when a session file is older than the lifetime.
  expired(file: string): boolean {
    return Date.now() - statSync(file).mtimeMs > this.lifetime * 1000;
  }

  // Returns the session cookie name: `__Host-hy-session` over HTTPS and `hy-session` otherwise (HY-45).
  static cookieName(secure: boolean): string {
    return secure ? '__Host-hy-session' : 'hy-session';
  }

  // Returns the Set-Cookie value of a new session, with the attributes of the PHP session cookie (HY-45).
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
  private readonly release: () => void;

  constructor(sessions: FileSessions, cookieId: string | null, release: () => void) {
    this.sessions = sessions;
    this.cookieId = cookieId;
    this.release = release;
  }

  // True when the request read or wrote session data.
  get started(): boolean {
    return this.values !== null;
  }

  // The identifier that this request created, which the response sets as the session cookie, or null.
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
  // session start.
  close(): void {
    try {
      if (this.renewedId !== null) rmSync(join(this.sessions.directory, this.renewedId), { force: true });
      if (this.values !== null && this.id !== null) {
        const file = join(this.sessions.directory, this.id);
        writeFileSync(`${file}.tmp`, serialize(this.values), { mode: 0o600 });
        renameSync(`${file}.tmp`, file);
      }
    } finally {
      this.release();
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
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (content !== null) {
        this.id = this.cookieId;
        this.values = deserialize(content) as Map<string, unknown>;
        return this.values;
      }
    }
    this.id = randomBytes(32).toString('hex');
    this.createdId = true;
    this.values = new Map();
    return this.values;
  }
}
