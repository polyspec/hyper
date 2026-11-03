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

from .session_record import _IDENTIFIER, RecordSession, _accepted

_PREFIX = "sess_"
_OPEN = os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC


def _cookie_name(secure: bool) -> str:
    """Returns the session cookie name: `__Host-hy-session` over HTTPS and `hy-session` otherwise (HY-45)."""
    return "__Host-hy-session" if secure else "hy-session"


def _cookie_header(identifier: str, secure: bool) -> str:
    """Returns the Set-Cookie value of a new session, with the attributes of the PHP session cookie (HY-45)."""
    return f"{_cookie_name(secure)}={identifier}; path=/{'; secure' if secure else ''}; HttpOnly; SameSite=Lax"


class FileSessions:
    """Opens one session store per request; the requests of one session run one after another, in one process and in
    every process that keeps its sessions in the directory (HY-104)."""

    def __init__(self, directory: str, lifetime: int = 1440):
        path = Path(directory)
        if not path.is_absolute() or not path.is_dir():
            raise ValueError(
                f"session directory {directory} must be an existing absolute directory"
            )
        if lifetime <= 0:
            raise ValueError("session lifetime must be a positive number of seconds")
        self.directory = path
        self.lifetime = lifetime

    def _open(self, cookie: Optional[str]) -> "FileSession":
        """Returns the store of a request with the value of its session cookie; it holds the lock of the session
        file until `close`. An identifier in another form or without a file names no session (HY-45)."""
        identifier = _accepted(cookie)
        if identifier is None:
            return FileSession(self, None, None)
        held = self._hold(identifier, blocking=True)
        return FileSession(self, identifier if held is not None else None, held)

    def _file(self, identifier: str) -> Path:
        """Returns the path of the session file of an identifier."""
        return self.directory / f"{_PREFIX}{identifier}"

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
        for file in sorted(self.directory.iterdir()):
            if not file.name.startswith(_PREFIX):
                continue
            identifier = file.name.removeprefix(_PREFIX)
            if _IDENTIFIER.fullmatch(identifier) is None or self._live(file):
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

    def _live(self, file: Path) -> bool:
        """Returns False when a session file is missing or older than the lifetime."""
        try:
            return not self._expired(file.stat(follow_symlinks=False).st_mtime)
        except FileNotFoundError:
            return False

    def _expired(self, modified: float) -> bool:
        """Returns True when a modification time is older than the lifetime."""
        return time.time() - modified > self.lifetime


class FileSession(RecordSession):
    """The session store of one request (HY-24, HY-45, HY-72)."""

    def __init__(
        self, sessions: FileSessions, identifier: Optional[str], held: Optional[int]
    ):
        super().__init__(identifier)
        self._sessions = sessions
        self._held = held

    def _stored(self) -> Optional[bytes]:
        if self._held is None or self._sessions._expired(os.fstat(self._held).st_mtime):
            return None
        return _read(self._held)

    def _close(self) -> None:
        """Writes a started session to its file, removes the file of a renewed identifier and lets the next request of
        the session start. A session that the request did not change keeps its bytes and takes a new modification
        time, as PHP does with `session.lazy_write`."""
        try:
            record = self._serialized()
            if record is None:
                return
            if self._made:
                self._create(record)
            elif self._held is not None:
                self._replace(self._held, record)
            if self._renewed is not None:
                self._sessions._file(self._renewed).unlink(missing_ok=True)
        finally:
            if self._held is not None:
                os.close(self._held)

    def _create(self, record: bytes) -> None:
        """Creates the file of a new identifier with the mode 0600; no other process knows the identifier yet."""
        descriptor = os.open(
            self._sessions._file(_present(self._id)),
            _OPEN | os.O_CREAT | os.O_EXCL,
            0o600,
        )
        try:
            _write(descriptor, record)
        finally:
            os.close(descriptor)

    def _replace(self, descriptor: int, record: bytes) -> None:
        """Writes a record over the file of the session in place, under its lock, as PHP does."""
        if record == self._read:
            os.utime(descriptor)
            return
        _write(descriptor, record)
        os.ftruncate(descriptor, len(record))


def _present(identifier: Optional[str]) -> str:
    """Returns the identifier of a session that has started."""
    if identifier is None:
        raise RuntimeError("a session without an identifier has no file")
    return identifier


def _read(descriptor: int) -> bytes:
    """Returns the bytes of a session file from its start."""
    chunks = []
    offset = 0
    while chunk := os.pread(descriptor, 1 << 20, offset):
        chunks.append(chunk)
        offset += len(chunk)
    return b"".join(chunks)


def _write(descriptor: int, record: bytes) -> None:
    """Writes the bytes of a record at the start of a session file."""
    view = memoryview(record)
    offset = 0
    while offset < len(view):
        offset += os.pwrite(descriptor, view[offset:], offset)
