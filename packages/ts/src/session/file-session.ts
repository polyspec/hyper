// The session store of one request of the file sessions (HY-24, HY-45, HY-72, HY-104): the record session of the file
// store of the session-store library, whose values this class gives and takes as values of the data model.
import * as library from '@polyspec/session-store';
import { rules } from '../app/core-rules.js';
import type { SessionStore } from './session-store.js';

// The prefix of the names of the category classes of the session-store package, such as `SessionStoreStoreError`.
const LIBRARY_PREFIX = 'SessionStore';

// Runs a call of the session-store library that returns at once. A failure of the library is thrown as the error of
// hyper of the same role, with its kind, status and message (HY-132.3); any other failure is thrown as it is.
/** @internal */
export function converted<T>(call: () => T): T {
  try {
    return call();
  } catch (error) {
    throw rules().libraryError(library, LIBRARY_PREFIX, error);
  }
}

// Runs a call of the session-store library that waits, and throws its failure as `converted` does.
/** @internal */
export async function awaited<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw rules().libraryError(library, LIBRARY_PREFIX, error);
  }
}

/** @internal */
export class FileSession implements SessionStore {
  private readonly session: library.FileSession | library.RedisSession;
  // The identifier that the close wrote for a new session, which the response sets as the session cookie.
  private made: string | null;

  constructor(session: library.FileSession | library.RedisSession) {
    this.session = session;
    this.made = null;
  }

  // Returns the value of a key as a value of the data model (HY-104.13), or null for a key that holds no value
  // (HY-104.37). The library gives one value for a key that holds none and for a key that holds the PHP value null.
  get(key: string): unknown {
    const record = converted(() => this.session.get(key));
    return record === null ? null : rules().sessionValue(record);
  }

  // Stores a value of the data model as the PHP value of the record (HY-104.14).
  set(key: string, item: unknown): void {
    const record = rules().sessionRecord(item);
    converted(() => {
      this.session.set(key, record);
    });
  }

  remove(key: string): void {
    converted(() => {
      this.session.remove(key);
    });
  }

  // Gives the values a new identifier, which the response sets as the session cookie; closing deletes the old session
  // (HY-72).
  renew(): void {
    converted(() => {
      this.session.renew();
    });
  }

  // Writes the values that the request changed, releases the lock of the session and its turn, and keeps the
  // identifier that the store wrote for a new session.
  async close(): Promise<void> {
    this.made = await awaited(() => this.session.close());
  }

  // Returns the identifier that this request created, which the response sets as the session cookie, or null. It is
  // known after the close.
  created(): string | null {
    return this.made;
  }
}
