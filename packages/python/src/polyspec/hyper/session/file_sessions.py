"""Sessions in files of one directory, in the form of the files handler of PHP, for a server process (HY-45, HY-104):
the file store of the session-store library, whose rule the storage of a session is (HY-104.25). A session is the
file `sess_<id>`, whose bytes are the `php_serialize` record of its values, so the PHP, Node and Python servers that
share the directory share its sessions. The store accepts the identifier of an existing file: a cookie value in
another form or without an unexpired file starts a new session. The session starts on the first read or write, so a
request that never uses it creates no session. A request holds `flock` on the session file from its opening to its
closing, as PHP does: the library orders the requests of this process in a queue and waits for the lock of the other
processes with no retry and no pause (HY-104.27), and the operating system releases the lock of a process that
ended. A failure of the library is an error of hyper of the same category with the kind of the library (HY-132.3)."""

from __future__ import annotations

from typing import Optional

import polyspec.session_store as library

from ._file_session import FileSession, converted


class FileSessions:
    """Opens one session store per request; the requests of one session run one after another, in one process and in
    every process that keeps its sessions in the directory (HY-104)."""

    def __init__(self, directory: str, lifetime: int = 1440):
        """Makes the store of an existing absolute directory. Making it with another directory fails with the kind
        `invalid_directory` and with a lifetime of 0 with `invalid_lifetime` (HY-104.32); the binding of the library
        refuses a lifetime that is no integer of 0 or more with `invalid_number`, and one that is no number with
        `invalid_argument_type`."""
        self._store = converted(
            lambda: library.FileSessions.in_directory(directory, lifetime)
        )

    def _open(self, cookie: Optional[str]) -> "FileSession":
        """Returns the store of a request with the value of its session cookie, after the earlier requests of the same
        session have ended; it holds the lock of the session file until `close`. An identifier in another form or
        without a file names no session (HY-45)."""
        return FileSession(converted(lambda: self._store.open(cookie)))

    def collect(self) -> int:
        """Removes the files of the sessions that ended and returns how many it removed; a file whose lock a request
        holds is skipped. The store never collects by itself: the application calls this when it chooses, such as
        from a scheduled task (HY-104.33, SF-5)."""
        return converted(self._store.collect)
