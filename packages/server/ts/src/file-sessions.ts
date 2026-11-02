// Sessions in files of one absolute directory, in the form of the files handler of PHP, for a server process (HY-45, HY-104).
import { randomBytes } from 'node:crypto';
import { closeSync, constants, fstatSync, ftruncateSync, futimesSync, lstatSync, openSync, readdirSync, readSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { isAbsolute, join } from 'node:path';
import { PhpFloat, Reference, serialize, StdClass, unserialize, type ArrayKey, type Value as Stored } from '@polyspec/php-serialize';
import { errorCode } from './error-code.js';
import { exclusiveLock } from './flock.js';
import type { SessionStore } from './session.js';

export interface FileSessionsOptions {
  // An existing absolute directory; the server processes that share it share its sessions (HY-104).
  directory: string;
  // Seconds after the last request of a session until the session ends; PHP's session.gc_maxlifetime is 1440.
  lifetime?: number;
}

const IDENTIFIER = /^[A-Za-z0-9,-]{22,128}$/;
const PREFIX = 'sess_';
const OPEN = constants.O_RDWR | constants.O_NOFOLLOW;
// The milliseconds between two tries of a lock that another process holds, from the first to the longest.
const FIRST_TRY = 2;
const LONGEST_TRY = 50;

// Returns the value of the data model of a value that a record holds: a float is its number, a stdClass is a map and a
// reference is its value. Bytes that are not UTF-8 and an integer outside the data model stay what they are, and the
// application fails on them as on any other value.
function value(stored: Stored | undefined): unknown {
  if (stored instanceof Reference) return value(stored.value);
  if (stored instanceof PhpFloat) return stored.value;
  if (stored instanceof StdClass) return map(stored.properties);
  if (stored instanceof Map) return map(stored);
  if (Array.isArray(stored)) return stored.map(value);
  return stored;
}

function map(stored: Map<ArrayKey, Stored>): Map<string | Uint8Array, unknown> {
  const result = new Map<string | Uint8Array, unknown>();
  for (const [key, item] of stored) result.set(keyOf(key), value(item));
  return result;
}

// Returns the key of the data model of an array key: an integer is its decimal text, and bytes that are not UTF-8 stay bytes.
function keyOf(key: ArrayKey): string | Uint8Array {
  return typeof key === 'number' || typeof key === 'bigint' ? String(key) : key;
}

// Returns what the record holds for a value of the data model. A PHP array cannot tell an empty map or a map with the
// keys 0 to n-1 from a list, so such a map is a stdClass, which PHP reads as a map of the data model.
// A value outside the data model fails here, in the request that stores it.
function recorded(input: unknown): Stored {
  if (Array.isArray(input)) return input.map(recorded);
  if (input instanceof Map) return recordedMap(input);
  if (input === null || typeof input === 'boolean' || typeof input === 'number' || typeof input === 'bigint' || typeof input === 'string') return input;
  if (input instanceof Uint8Array || input instanceof PhpFloat || input instanceof StdClass || input instanceof Reference) return input;
  throw new TypeError('hyper: a session value is outside the data model');
}

function recordedMap(input: Map<unknown, unknown>): Stored {
  const items = new Map<string, Stored>();
  let index = 0;
  let listShaped = true;
  for (const [key, item] of input) {
    if (typeof key !== 'string') throw new TypeError('hyper: a session map has a key that is not a string');
    listShaped &&= key === String(index++);
    items.set(key, recorded(item));
  }
  return listShaped ? new StdClass(items) : items;
}

// Returns the values of a session record by name. A session file without bytes is an empty session, as PHP creates it,
// and any other record that is no array fails the request (HY-104).
function values(record: Uint8Array, file: string): Map<string | Uint8Array, Stored> {
  if (record.length === 0) return new Map();
  const stored = unserialize(record);
  if (Array.isArray(stored)) return new Map(stored.map((item, index) => [String(index), item]));
  if (stored instanceof Map) return new Map([...stored].map(([key, item]) => [keyOf(key), item]));
  throw new Error(`hyper: session file ${file} holds no map of values`);
}

// Returns the bytes of an open session file from its start.
function read(descriptor: number): Buffer {
  const chunks: Buffer[] = [];
  let offset = 0;
  for (;;) {
    const chunk = Buffer.allocUnsafe(1 << 20);
    const size = readSync(descriptor, chunk, 0, chunk.length, offset);
    if (size === 0) return Buffer.concat(chunks);
    chunks.push(chunk.subarray(0, size));
    offset += size;
  }
}

// Writes the bytes of a record at the start of an open session file.
function write(descriptor: number, record: Uint8Array): void {
  for (let offset = 0; offset < record.length; ) offset += writeSync(descriptor, record, offset, record.length - offset, offset);
}

// Opens one session store per request. A session is the file `sess_<id>`, whose bytes are the php_serialize record of its
// values, so the PHP, Node and Python servers that share the directory share its sessions. The server accepts only
// identifiers of an existing file: a cookie value in another form or without an unexpired file starts a new session.
// The session starts on the first read or write, so a request that never uses it creates no session. A request holds
// flock on the session file from its opening to its closing, as PHP does: a queue orders the requests of this process, so
// they do not try the lock against each other, and the lock those of every process of the directory (HY-104). The
// operating system releases the lock of a process that ended. The lock is tried without blocking and again after a pause,
// because a call that blocks would stop the event loop of this process.
export class FileSessions {
  /** @internal */
  readonly directory: string;
  /** @internal */
  readonly lifetime: number;
  private readonly queues = new Map<string, Promise<void>>();
  private readonly lock: (descriptor: number) => boolean;

  constructor(options: FileSessionsOptions) {
    if (!isAbsolute(options.directory) || !statSync(options.directory).isDirectory()) {
      throw new Error(`hyper: session directory ${options.directory} must be an existing absolute directory`);
    }
    const lifetime = options.lifetime ?? 1440;
    if (!Number.isSafeInteger(lifetime) || lifetime <= 0) throw new Error('hyper: session lifetime must be a positive number of seconds');
    this.directory = options.directory;
    this.lifetime = lifetime;
    this.lock = exclusiveLock();
  }

  // Opens the store of a request with the value of its session cookie, after the earlier requests of the same
  // session have ended. The caller calls `close` of the store when the response is complete.
  /** @internal */
  async open(cookie: string | null): Promise<FileSession> {
    const id = cookie !== null && IDENTIFIER.test(cookie) ? cookie : null;
    if (id === null) return new FileSession(this, null, null, () => {});
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
    let held: number | null;
    try {
      held = await this.hold(id);
    } catch (error) {
      leave();
      throw error;
    }
    if (held === null) {
      leave();
      return new FileSession(this, null, null, () => {});
    }
    const descriptor = held;
    return new FileSession(this, id, descriptor, () => {
      try {
        closeSync(descriptor);
      } finally {
        leave();
      }
    });
  }

  /** @internal */
  file(id: string): string {
    return join(this.directory, `${PREFIX}${id}`);
  }

  // Takes the exclusive lock of a session file and returns its descriptor, which closing releases, or null without a file.
  private async hold(id: string): Promise<number | null> {
    let pause = FIRST_TRY;
    for (;;) {
      const descriptor = this.tryHold(id);
      if (descriptor !== 'busy') return descriptor;
      await delay(pause);
      pause = Math.min(pause * 2, LONGEST_TRY);
    }
  }

  // Tries the lock once. A holder may remove the file, so the lock counts only when the path still names the file that
  // was locked; a path that names another file is tried again.
  private tryHold(id: string): number | null | 'busy' {
    for (;;) {
      let descriptor: number;
      try {
        descriptor = openSync(this.file(id), OPEN);
      } catch (error) {
        if (errorCode(error) === 'ENOENT') return null;
        throw error;
      }
      try {
        if (!this.lock(descriptor)) {
          closeSync(descriptor);
          return 'busy';
        }
        const locked = fstatSync(descriptor);
        const current = lstatSync(this.file(id), { throwIfNoEntry: false });
        if (current !== undefined && current.dev === locked.dev && current.ino === locked.ino) return descriptor;
      } catch (error) {
        closeSync(descriptor);
        throw error;
      }
      closeSync(descriptor);
    }
  }

  // Removes the files of sessions whose lifetime has passed and returns how many it removed. It skips a session whose
  // lock a request holds.
  /** @internal */
  collect(): number {
    let removed = 0;
    for (const name of readdirSync(this.directory)) {
      if (!name.startsWith(PREFIX)) continue;
      const id = name.slice(PREFIX.length);
      if (!IDENTIFIER.test(id) || !this.ended(id)) continue;
      const held = this.tryHold(id);
      if (held === null || held === 'busy') continue;
      try {
        if (this.expired(fstatSync(held).mtimeMs)) {
          unlinkSync(this.file(id));
          removed++;
        }
      } finally {
        closeSync(held);
      }
    }
    return removed;
  }

  // Returns true when the session of an identifier has a file that is older than the lifetime; another process may have
  // removed it.
  private ended(id: string): boolean {
    const stat = lstatSync(this.file(id), { throwIfNoEntry: false });
    return stat !== undefined && this.expired(stat.mtimeMs);
  }

  // Returns true when a modification time is older than the lifetime.
  /** @internal */
  expired(modified: number): boolean {
    return Date.now() - modified > this.lifetime * 1000;
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
  // The record as it was read and as the request changed it: a value that the request did not set stays what PHP wrote,
  // so a request that does not change it writes the same bytes back.
  private values: Map<string | Uint8Array, Stored> | null = null;
  private stored: Uint8Array | null = null;
  private id: string | null = null;
  private createdId = false;
  private renewedId: string | null = null;
  private readonly sessions: FileSessions;
  private readonly cookieId: string | null;
  private readonly held: number | null;
  private readonly release: () => void;

  constructor(sessions: FileSessions, cookieId: string | null, held: number | null, release: () => void) {
    this.sessions = sessions;
    this.cookieId = cookieId;
    this.held = held;
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
    return value(this.start().get(key));
  }

  set(key: string, item: unknown): void {
    this.start().set(key, recorded(item));
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
  // session start. A session that the request did not change keeps its bytes and takes a new modification time, as PHP
  // does with session.lazy_write.
  /** @internal */
  async close(): Promise<void> {
    try {
      if (this.values === null || this.id === null) return;
      const record = serialize(this.values);
      if (this.createdId) this.create(this.id, record);
      else if (this.held !== null) this.replace(this.held, record);
      if (this.renewedId !== null) unlinkSync(this.sessions.file(this.renewedId));
    } finally {
      this.release();
    }
  }

  // Creates the file of a new identifier with the mode 0600; no other process knows the identifier yet.
  private create(id: string, record: Uint8Array): void {
    const descriptor = openSync(this.sessions.file(id), OPEN | constants.O_CREAT | constants.O_EXCL, 0o600);
    try {
      write(descriptor, record);
    } finally {
      closeSync(descriptor);
    }
  }

  // Writes a record over the file of the session in place, under its lock, as PHP does.
  private replace(descriptor: number, record: Uint8Array): void {
    if (this.stored !== null && Buffer.compare(this.stored, record) === 0) {
      const now = new Date();
      futimesSync(descriptor, now, now);
      return;
    }
    write(descriptor, record);
    ftruncateSync(descriptor, record.length);
  }

  private start(): Map<string | Uint8Array, Stored> {
    if (this.values !== null) return this.values;
    if (this.held !== null && this.cookieId !== null && !this.sessions.expired(fstatSync(this.held).mtimeMs)) {
      this.stored = read(this.held);
      this.values = values(this.stored, this.sessions.file(this.cookieId));
      this.id = this.cookieId;
      return this.values;
    }
    this.id = randomBytes(32).toString('hex');
    this.createdId = true;
    this.values = new Map();
    return this.values;
  }
}
