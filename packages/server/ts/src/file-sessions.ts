// Sessions in files of one absolute directory, in the form of the files handler of PHP, for a server process (HY-45, HY-104).
import { closeSync, constants, fstatSync, ftruncateSync, futimesSync, lstatSync, openSync, readdirSync, readSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { isAbsolute, join } from 'node:path';
import { errorCode } from './error-code.js';
import { exclusiveLock } from './flock.js';
import { accepted, RecordSession, SessionTurns } from './session-record.js';

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
  private readonly lock: (descriptor: number) => boolean;
  private readonly turns = new SessionTurns();

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
    const id = accepted(cookie);
    if (id === null) return new FileSession(this, null, null, () => {});
    const leave = await this.turns.enter(id);
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
}

// The session store of one request.
export class FileSession extends RecordSession {
  private readonly sessions: FileSessions;
  private readonly held: number | null;
  private readonly release: () => void;

  constructor(sessions: FileSessions, cookieId: string | null, held: number | null, release: () => void) {
    super(
      cookieId,
      () => (held !== null && !sessions.expired(fstatSync(held).mtimeMs) ? read(held) : null),
      (id) => `file ${sessions.file(id)}`,
    );
    this.sessions = sessions;
    this.held = held;
    this.release = release;
  }

  // Writes a started session to its file, removes the file of a renewed identifier, and lets the next request of the
  // session start. A session that the request did not change keeps its bytes and takes a new modification time, as PHP
  // does with session.lazy_write.
  /** @internal */
  async close(): Promise<void> {
    try {
      const pending = this.pending();
      if (pending === null) return;
      if (pending.created) this.create(pending.id, pending.record);
      else if (this.held !== null) this.replace(this.held, pending.record, pending.changed);
      if (pending.renewed !== null) unlinkSync(this.sessions.file(pending.renewed));
    } finally {
      this.release();
    }
    return Promise.resolve();
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
  private replace(descriptor: number, record: Uint8Array, changed: boolean): void {
    if (!changed) {
      const now = new Date();
      futimesSync(descriptor, now, now);
      return;
    }
    write(descriptor, record);
    ftruncateSync(descriptor, record.length);
  }
}
