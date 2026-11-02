"""Sessions in files of one directory, for a server process (HY-45). A session file is named by its identifier, so
the server accepts only identifiers that it created: a cookie value that is not 64 lowercase hexadecimal digits or
has no unexpired file starts a new session. The session starts on the first read or write, so a request that never
uses it creates no session. The values are values of the template data model, written as JSON. A request holds the
exclusive lock of its session from its opening to its closing, so the requests of one session run one after another in
every process of the directory (HY-104)."""

from __future__ import annotations

import contextlib
import fcntl
import json
import os
import re
import secrets
import tempfile
import threading
import time
from pathlib import Path
from typing import Optional

_IDENTIFIER = re.compile(r"[0-9a-f]{64}\Z")


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
        self._locks: dict[str, threading.Lock] = {}

    def _open(self, cookie: Optional[str]) -> "FileSession":
        """Returns the store of a request with the value of its session cookie; it holds the turn of the session
        until `close`, so the requests of one session run one after another. The thread lock orders the requests of
        this process and the lock file `<id>.lock` those of every process (HY-104)."""
        identifier = (
            cookie
            if cookie is not None and _IDENTIFIER.fullmatch(cookie) is not None
            else None
        )
        lock = None
        held = None
        if identifier is not None:
            lock = self._locks.setdefault(identifier, threading.Lock())
            lock.acquire()
            try:
                held = self._hold(identifier, blocking=True)
            except BaseException:
                lock.release()
                raise
        return FileSession(self, identifier, lock, held)

    def _hold(self, identifier: str, blocking: bool) -> Optional[int]:
        """Takes the exclusive lock of the lock file of a session and returns its descriptor, which closing releases;
        without `blocking` it returns None while another holds the lock. A holder may remove the lock file, so the
        lock counts only when the path still names the file that was locked; otherwise the lock is taken anew on
        the file of the path."""
        path = self.directory / f"{identifier}.lock"
        while True:
            descriptor = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
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
                    current = os.stat(path)
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
        """Removes the files of sessions whose lifetime has passed, with their lock files, and the lock files of
        sessions without a file, and returns how many session files it removed. It skips a session whose lock a
        request holds."""
        removed = 0
        names = {file.name.removesuffix(".lock") for file in self.directory.iterdir()}
        for identifier in sorted(names):
            if _IDENTIFIER.fullmatch(identifier) is None or self._live(identifier):
                continue
            held = self._hold(identifier, blocking=False)
            if held is None:
                continue
            try:
                if not self._live(identifier):
                    with contextlib.suppress(FileNotFoundError):
                        (self.directory / identifier).unlink()
                        removed += 1
                    (self.directory / f"{identifier}.lock").unlink(missing_ok=True)
            finally:
                os.close(held)
        return removed

    def _live(self, identifier: str) -> bool:
        """Returns True when the session of an identifier has a file whose lifetime has not passed."""
        try:
            return not self._expired(self.directory / identifier)
        except FileNotFoundError:
            return False

    def _expired(self, file: Path) -> bool:
        """Returns True when a session file is older than the lifetime."""
        return time.time() - file.stat().st_mtime > self.lifetime


class FileSession:
    """The session store of one request (HY-24, HY-45, HY-72)."""

    def __init__(
        self,
        sessions: FileSessions,
        identifier: Optional[str],
        lock: Optional[threading.Lock],
        held: Optional[int],
    ):
        self._sessions = sessions
        self._cookie_id = identifier
        self._lock = lock
        self._held = held
        self._values: Optional[dict] = None
        self._id: Optional[str] = None
        self._made = False
        self._renewed: Optional[str] = None

    @property
    def _created(self) -> Optional[str]:
        """The identifier that this request created, which the response sets as the session cookie, or None."""
        return self._id if self._made else None

    def get(self, key: str) -> object:
        return self._start().get(key)

    def set(self, key: str, value: object) -> None:
        self._start()[key] = value

    def remove(self, key: str) -> None:
        self._start().pop(key, None)

    def renew(self) -> None:
        """Gives the values a new identifier, which the response sets as the session cookie; closing deletes the
        file of the old identifier (HY-72)."""
        self._start()
        if not self._made:
            self._renewed = self._id
        self._id = secrets.token_bytes(32).hex()
        self._made = True

    def _close(self) -> None:
        """Writes a started session to its file, removes the file of a renewed identifier, removes the lock file of
        a cookie identifier that names no session file, and lets the next request of the session start."""
        try:
            if self._renewed is not None:
                (self._sessions.directory / self._renewed).unlink(missing_ok=True)
            if self._values is not None and self._id is not None:
                file = self._sessions.directory / self._id
                # Each write has its own temporary file, so two writers of one session never share a name (HY-104).
                # One rename publishes the file, so a reader finds the previous or the new session (HR-82). The
                # file of mkstemp has the mode 0600, as the session file of the TypeScript server has (HY-104).
                descriptor, writing = tempfile.mkstemp(
                    dir=self._sessions.directory, prefix=f"{self._id}.", suffix=".tmp"
                )
                try:
                    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                        stream.write(json.dumps(self._values))
                    os.replace(writing, file)
                except BaseException:
                    with contextlib.suppress(FileNotFoundError):
                        os.unlink(writing)
                    raise
        finally:
            try:
                if (
                    self._held is not None
                    and self._cookie_id is not None
                    and not (self._sessions.directory / self._cookie_id).exists()
                ):
                    (self._sessions.directory / f"{self._cookie_id}.lock").unlink(
                        missing_ok=True
                    )
            finally:
                if self._held is not None:
                    os.close(self._held)
                if self._lock is not None:
                    self._lock.release()

    def _start(self) -> dict:
        if self._values is not None:
            return self._values
        if self._cookie_id is not None:
            file = self._sessions.directory / self._cookie_id
            content = None
            # Only a missing file starts a new session; any other failure of the read raises (HY-104).
            try:
                if not self._sessions._expired(file):
                    content = json.loads(file.read_text(encoding="utf-8"))
            except FileNotFoundError:
                content = None
            if content is not None:
                self._id = self._cookie_id
                self._values = content
                return self._values
        self._id = secrets.token_bytes(32).hex()
        self._made = True
        self._values = {}
        return self._values
