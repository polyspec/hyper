"""Sessions in files of one directory, in the form of the files handler of PHP, for a server process (HY-45, HY-104).
A session is the file `sess_<id>`, whose bytes are the `php_serialize` record of its values, so the PHP, Node and
Python servers that share the directory share its sessions. The server accepts only identifiers of an existing file:
a cookie value in another form or without an unexpired file starts a new session. The session starts on the first read
or write, so a request that never uses it creates no session. A request holds `flock` on the session file from its
opening to its closing, as PHP does, so the requests of one session run one after another in every process of the
directory, and the operating system releases the lock of a process that ended."""

from __future__ import annotations

import contextlib
import fcntl
import os
import time
from pathlib import Path
from typing import Optional

from ._file_session import FileSession
from ._record_session import _IDENTIFIER, RecordSession

_PREFIX = "sess_"
_OPEN = os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC


class FileSessions:
    """Opens one session store per request; the requests of one session run one after another, in one process and in
    every process that keeps its sessions in the directory (HY-104)."""

    _directory: Path
    _lifetime: int

    def __init__(self, directory: str, lifetime: int = 1440):
        path = Path(directory)
        if not path.is_absolute() or not path.is_dir():
            raise ValueError(
                f"session directory {directory} must be an existing absolute directory"
            )
        if lifetime <= 0:
            raise ValueError("session lifetime must be a positive number of seconds")
        self._directory = path
        self._lifetime = lifetime

    def _open(self, cookie: Optional[str]) -> "FileSession":
        """Returns the store of a request with the value of its session cookie; it holds the lock of the session
        file until `close`. An identifier in another form or without a file names no session (HY-45)."""
        identifier = RecordSession.accepted(cookie)
        if identifier is None:
            return FileSession(self, None, None)
        held = self._hold(identifier, blocking=True)
        return FileSession(self, identifier if held is not None else None, held)

    def _file(self, identifier: str) -> Path:
        """Returns the path of the session file of an identifier."""
        return self._directory / f"{_PREFIX}{identifier}"

    def _hold(self, identifier: str, blocking: bool) -> Optional[int]:
        """Takes the exclusive lock of a session file and returns its descriptor, which closing releases. It returns
        None without a file and, without `blocking`, while another holds the lock. A holder may remove the file, so
        the lock counts only when the path still names the file that was locked."""
        path = self._file(identifier)
        while True:
            try:
                descriptor = os.open(path, _OPEN)
            except FileNotFoundError:
                return None
            try:
                try:
                    fcntl.flock(
                        descriptor,
                        fcntl.LOCK_EX if blocking else fcntl.LOCK_EX | fcntl.LOCK_NB,
                    )
                except BlockingIOError:
                    os.close(descriptor)
                    return None
                locked = os.fstat(descriptor)
                try:
                    current = os.stat(path, follow_symlinks=False)
                except FileNotFoundError:
                    current = None
            except BaseException:
                with contextlib.suppress(OSError):
                    os.close(descriptor)
                raise
            if current is not None and (current.st_dev, current.st_ino) == (
                locked.st_dev,
                locked.st_ino,
            ):
                return descriptor
            os.close(descriptor)

    def _collect(self) -> int:
        """Removes the files of sessions whose lifetime has passed and returns how many it removed. It skips a session
        whose lock a request holds."""
        removed = 0
        for file in sorted(self._directory.iterdir()):
            if not file.name.startswith(_PREFIX):
                continue
            identifier = file.name.removeprefix(_PREFIX)
            if _IDENTIFIER.fullmatch(identifier) is None or self._live(identifier):
                continue
            held = self._hold(identifier, blocking=False)
            if held is None:
                continue
            try:
                if not self._expired(os.fstat(held).st_mtime):
                    continue
                file.unlink()
                removed += 1
            finally:
                os.close(held)
        return removed

    def _live(self, identifier: str) -> bool:
        """Returns False when the session file of an identifier is missing or older than the lifetime."""
        try:
            return not self._expired(
                self._file(identifier).stat(follow_symlinks=False).st_mtime
            )
        except FileNotFoundError:
            return False

    def _expired(self, modified: float) -> bool:
        """Returns True when a modification time is older than the lifetime."""
        return time.time() - modified > self._lifetime
