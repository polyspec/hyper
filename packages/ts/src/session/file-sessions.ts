// Sessions in files of one absolute directory, in the form of the files handler of PHP, for a server process (HY-45,
// HY-104): the file store of the session-store library, whose rule the storage of a session is (HY-104.25).
import { FileSessions as LibraryFileSessions } from '@polyspec/session-store';
import { awaited, FileSession } from './file-session.js';
import { ArgumentCountError } from '../app/argument-count-error.js';

export interface FileSessionsOptions {
  // An existing absolute directory; the server processes that share it share its sessions (HY-104).
  directory: string;
  // Seconds after the last request of a session until the session ends; PHP's session.gc_maxlifetime is 1440.
  lifetime?: number;
}

// The names of the options of the store, the members of its options record (HY-106.9).
const FILE_SESSIONS_REQUIRED = ['directory'];
const FILE_SESSIONS_OPTIONAL = ['lifetime'];

// Opens one session store per request. A session is the file `sess_<id>`, whose bytes are the php_serialize record of its
// values, so the PHP, Node and Python servers that share the directory share its sessions. The store accepts the
// identifier of an existing file: a cookie value in another form or without an unexpired file starts a new session.
// The session starts on the first read or write, so a request that never uses it creates no session. A request holds
// flock on the session file from its opening to its closing, as PHP does: the library orders the requests of this
// process in a queue and waits for the lock of the other processes on a thread of its own, with no retry and no pause
// (HY-104.27), so the event loop of this process goes on. A failure of the library is an error of hyper of the same
// category with the kind of the library (HY-133.3).
export class FileSessions {
  private readonly store: LibraryFileSessions;

  private constructor(store: LibraryFileSessions) {
    this.store = store;
  }

  // Makes the store of an existing absolute directory. Making it with another directory fails with the kind
  // `invalid_directory` and with a lifetime of 0 with `invalid_lifetime` (HY-104.32); the binding of the library refuses
  // a lifetime that is no integer of 0 or more with `invalid_number`, and one that is no number with
  // `invalid_argument_type`. The library makes a store only with a call that waits, so this class has no public
  // constructor.
  static async inDirectory(options: FileSessionsOptions): Promise<FileSessions> {
    ArgumentCountError.between(arguments.length, 1, 1);
    ArgumentCountError.members(options, FILE_SESSIONS_REQUIRED, FILE_SESSIONS_OPTIONAL);
    // `this` is the class that the maker was called on, so a class that extends this one gives its own instance.
    return new this(await awaited(() => LibraryFileSessions.inDirectory(options.directory, options.lifetime)));
  }

  /** @internal */
  get directory(): string {
    const directory = this.store.directory;
    return typeof directory === 'string' ? directory : Buffer.from(directory).toString('latin1');
  }

  /** @internal */
  get lifetime(): number {
    return this.store.lifetime;
  }

  // Opens the store of a request with the value of its session cookie, after the earlier requests of the same
  // session have ended. The caller calls `close` of the store when the response is complete.
  /** @internal */
  async open(cookie: string | null): Promise<FileSession> {
    return new FileSession(await awaited(() => this.store.open(cookie)));
  }

  // Removes the files of the sessions that ended and returns how many it removed; a file whose lock a request holds
  // is skipped. The store never collects by itself: a server calls this on a schedule of its choice.
  async collect(): Promise<number> {
    ArgumentCountError.between(arguments.length, 0, 0);
    return awaited(() => this.store.collect());
  }
}
