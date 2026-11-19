// The session stores of a server process over a store of the session-store library, the file store or the Redis store
// (HY-104.25, HY-115): a host opens the session of a request in `library` with `FileSession.opened`.
import type * as library from '@polyspec/session-store';

/** @internal */
export class LibrarySessions<Store extends library.FileSessions | library.RedisSessions = library.FileSessions | library.RedisSessions> {
  // The store of the library, which the constructor of each store sets once.
  /** @internal */
  readonly library: Store;

  constructor(store: Store) {
    this.library = store;
  }
}
