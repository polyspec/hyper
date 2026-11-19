"""The session stores of a server process over a store of the session-store library, the file store or the Redis store
(HY-104.25, HY-115): a host opens the session of a request in `library` with `FileSession.opened`."""

from __future__ import annotations

from typing import Generic, TypeVar

import polyspec.session_store as library

Store = TypeVar("Store", library.FileSessions, library.RedisSessions)


class LibrarySessions(Generic[Store]):
    """The store of the library, which the constructor of each store sets once."""

    library: Store

    def __init__(self, store: Store) -> None:
        self.library = store
