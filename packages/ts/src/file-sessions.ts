// Sessions in files of one absolute directory, in the form of the files handler of PHP, for a server process (HY-45, HY-104).
import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { isAbsolute, join } from 'node:path';
import { exclusiveLock } from './flock.js';
import { FileSession } from './file-session.js';
import { RecordSession } from './record-session.js';
import { SessionTurns } from './session-turns.js';
import { ArgumentCountError } from './argument-count-error.js';

export interface FileSessionsOptions {
  // An existing absolute directory; the server processes that share it share its sessions (HY-104).
  directory: string;
  // Seconds after the last request of a session until the session ends; PHP's session.gc_maxlifetime is 1440.
  lifetime?: number;
}

// The names of the options of the store, the members of its options record (HY-106.9).
const FILE_SESSIONS_REQUIRED = ['directory'];
const FILE_SESSIONS_OPTIONAL = ['lifetime'];
const IDENTIFIER = /^[A-Za-z0-9,-]{22,128}$/;
const PREFIX = 'sess_';
const OPEN = constants.O_RDWR | constants.O_NOFOLLOW;
// The milliseconds between two tries of a lock that another process holds, from the first to the longest.
const FIRST_TRY = 2;
const LONGEST_TRY = 50;

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
  /** @internal */
  readonly turns: SessionTurns;

  constructor(options: FileSessionsOptions) {
    ArgumentCountError.between(arguments.length, 1, 1);
    ArgumentCountError.members(options, FILE_SESSIONS_REQUIRED, FILE_SESSIONS_OPTIONAL);
    this.turns = new SessionTurns();
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
    const id = RecordSession.accepted(cookie);
    if (id === null) return new FileSession(this, null, null);
    await this.turns.enter(id);
    let held: number | null;
    try {
      held = await this.hold(id, true);
    } catch (error) {
      this.turns.leave(id);
      throw error;
    }
    if (held === null) {
      this.turns.leave(id);
      return new FileSession(this, null, null);
    }
    return new FileSession(this, id, held);
  }

  /** @internal */
  file(id: string): string {
    return join(this.directory, `${PREFIX}${id}`);
  }

  // Takes the exclusive lock of a session file and returns its descriptor, which closing releases. It returns null
  // without a file and, without `blocking`, while another holds the lock. With `blocking` it tries the lock again after
  // a pause, because a call that blocks would stop the event loop (HY-104.6).
  private async hold(id: string, blocking: boolean): Promise<number | null> {
    let pause = FIRST_TRY;
    for (;;) {
      const descriptor = this.tryHold(id);
      if (descriptor !== 'busy') return descriptor;
      if (!blocking) return null;
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
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
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
      if (!IDENTIFIER.test(id) || this.live(id)) continue;
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

  // Returns false when the session file of an identifier is missing or older than the lifetime.
  private live(id: string): boolean {
    const stat = lstatSync(this.file(id), { throwIfNoEntry: false });
    return stat !== undefined && !this.expired(stat.mtimeMs);
  }

  // Returns true when a modification time is older than the lifetime.
  /** @internal */
  expired(modified: number): boolean {
    return Date.now() - modified > this.lifetime * 1000;
  }
}
