// The session store of one request of the file sessions (HY-24, HY-45, HY-72, HY-104): the record session of the file
// store of the session-store library, whose values this class gives and takes as values of the data model.
import * as library from '@polyspec/session-store';
import { binding } from '../app/core-rules.js';
import type { SessionStore } from './session-store.js';

// The prefix of the names of the category classes of the session-store package, such as `SessionStoreStoreError`.
const LIBRARY_PREFIX = 'SessionStore';

// The prefix of the name of the category classes of the binding of hyper, which stands in the place of the prefix of
// the category classes of a library: `SessionStoreStoreError` of the session-store package is `HyperStoreError`.
const OWN_PREFIX = 'Hyper';

/** @internal */
export class FileSession implements SessionStore {
  private readonly session: library.FileSession | library.RedisSession;
  // The identifier that the close wrote for a new session, which the response sets as the session cookie.
  private made: string | null;

  constructor(session: library.FileSession | library.RedisSession) {
    this.session = session;
    this.made = null;
  }

  // Runs a call of the session-store library that returns at once. A failure of the library is thrown as the error of
  // hyper of the same role, with its kind, status and message (HY-133.3); any other failure is thrown as it is.
  static converted<T>(call: () => T): T {
    try {
      return call();
    } catch (error) {
      throw FileSession.libraryError(library, LIBRARY_PREFIX, error);
    }
  }

  // Opens the session of a request with the value of its session cookie in a store of the library, the file store or
  // the Redis store, and returns it as the session store of the request; a failure is thrown as `converted` does.
  static async opened(store: library.FileSessions | library.RedisSessions, cookie: string | null): Promise<FileSession> {
    return new FileSession(await FileSession.awaited(() => store.open(cookie)));
  }

  // Runs a call of the session-store library that waits, and throws its failure as `converted` does.
  static async awaited<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      throw FileSession.libraryError(library, LIBRARY_PREFIX, error);
    }
  }

  // Returns the error of hyper for an error of a library that hyper uses (HY-133.3), or the error as it is. An error of
  // a library is an instance of a class that the package of the library exports. The class of hyper is the class of the
  // binding of hyper of the same role: the class of the same name, such as `RecordError`, or the category class, whose
  // name has `Hyper` where the category class of the library has `prefix`. The error of hyper has the message, the
  // kind, the status and the errno of the error of the library, so no kind and no category is listed here; a class of
  // the library without a class of hyper of its role is tried by its parent class, and an error that the class of hyper
  // refuses, because the contract of hyper does not list its kind, stays as it is.
  private static libraryError(library: object, prefix: string, error: unknown): unknown {
    if (!(error instanceof Error)) return error;
    const core = binding();
    for (let type: unknown = Object.getPrototypeOf(error); typeof type === 'object' && type !== null; type = Object.getPrototypeOf(type)) {
      const made: unknown = (type as { constructor?: unknown }).constructor;
      const name: unknown = typeof made === 'function' ? made.name : undefined;
      if (typeof name !== 'string' || name === '' || Reflect.get(library, name) !== made) continue;
      const role: unknown = Reflect.get(core, name.startsWith(prefix) ? `${OWN_PREFIX}${name.slice(prefix.length)}` : name);
      if (typeof role !== 'function') continue;
      const { kind, status, errno } = error as Error & { kind?: unknown; status?: unknown; errno?: unknown };
      try {
        // The constructor of an error class of a binding (E-2) takes the message, the kind, the status and the errno.
        const converted: unknown = Reflect.construct(role, [error.message, kind, status ?? null, errno ?? null]);
        return converted;
      } catch {
        return error;
      }
    }
    return error;
  }

  // Returns the value of a key as a value of the data model (HY-104.13), or null for a key that holds no value
  // (HY-104.37). The library gives one value for a key that holds none and for a key that holds the PHP value null.
  get(key: string): unknown {
    const record = FileSession.converted(() => this.session.get(key));
    return record === null ? null : binding().sessionValue(record);
  }

  // Stores a value of the data model as the PHP value of the record (HY-104.14).
  set(key: string, item: unknown): void {
    const record = binding().sessionRecord(item);
    FileSession.converted(() => {
      this.session.set(key, record);
    });
  }

  remove(key: string): void {
    FileSession.converted(() => {
      this.session.remove(key);
    });
  }

  // Gives the values a new identifier, which the response sets as the session cookie; closing deletes the old session
  // (HY-72).
  renew(): void {
    FileSession.converted(() => {
      this.session.renew();
    });
  }

  // Writes the values that the request changed, releases the lock of the session and its turn, and keeps the
  // identifier that the store wrote for a new session.
  async close(): Promise<void> {
    this.made = await FileSession.awaited(() => this.session.close());
  }

  // Returns the identifier that this request created, which the response sets as the session cookie, or null. It is
  // known after the close.
  created(): string | null {
    return this.made;
  }
}
