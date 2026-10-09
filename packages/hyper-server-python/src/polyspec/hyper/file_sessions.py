"""Sessions in files of one directory, for a server process (HY-45). A session file is named by its identifier, so
the server accepts only identifiers that it created: a cookie value that is not 64 lowercase hexadecimal digits or
has no unexpired file starts a new session. The session starts on the first read or write, so a request that never
uses it creates no session. The values are values of the template data model, written as JSON."""

from __future__ import annotations

import json
import re
import secrets
import threading
import time
from pathlib import Path
from typing import Optional

_IDENTIFIER = re.compile(r'[0-9a-f]{64}\Z')


def cookie_name(secure: bool) -> str:
    """Returns the session cookie name: `__Host-hy-session` over HTTPS and `hy-session` otherwise (HY-45)."""
    return '__Host-hy-session' if secure else 'hy-session'


def cookie_header(identifier: str, secure: bool) -> str:
    """Returns the Set-Cookie value of a new session, with the attributes of the PHP session cookie (HY-45)."""
    return f'{cookie_name(secure)}={identifier}; path=/{"; secure" if secure else ""}; HttpOnly; SameSite=Lax'


class FileSessions:
    """Opens one session store per request; the requests of one session run one after another."""

    def __init__(self, directory: str, lifetime: int = 1440):
        path = Path(directory)
        if not path.is_absolute() or not path.is_dir():
            raise ValueError(f'session directory {directory} must be an existing absolute directory')
        if lifetime <= 0:
            raise ValueError('session lifetime must be a positive number of seconds')
        self.directory = path
        self.lifetime = lifetime
        self._locks: dict[str, threading.Lock] = {}

    def open(self, cookie: Optional[str]) -> 'FileSession':
        """Returns the store of a request with the value of its session cookie; it holds the turn of the session
        until `close`, so the requests of one session run one after another."""
        identifier = cookie if cookie is not None and _IDENTIFIER.fullmatch(cookie) is not None else None
        lock = None
        if identifier is not None:
            lock = self._locks.setdefault(identifier, threading.Lock())
            lock.acquire()
        return FileSession(self, identifier, lock)

    def collect(self) -> int:
        """Removes the files of sessions whose lifetime has passed and returns how many it removed."""
        removed = 0
        for file in self.directory.iterdir():
            if _IDENTIFIER.fullmatch(file.name) is not None and self.expired(file):
                file.unlink()
                removed += 1
        return removed

    def expired(self, file: Path) -> bool:
        """Returns True when a session file is older than the lifetime."""
        return time.time() - file.stat().st_mtime > self.lifetime


class FileSession:
    """The session store of one request (HY-24, HY-45, HY-72)."""

    def __init__(self, sessions: FileSessions, identifier: Optional[str], lock: Optional[threading.Lock]):
        self._sessions = sessions
        self._cookie_id = identifier
        self._lock = lock
        self._values: Optional[dict] = None
        self._id: Optional[str] = None
        self._created = False
        self._renewed: Optional[str] = None

    @property
    def created(self) -> Optional[str]:
        """The identifier that this request created, which the response sets as the session cookie, or None."""
        return self._id if self._created else None

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
        if not self._created:
            self._renewed = self._id
        self._id = secrets.token_bytes(32).hex()
        self._created = True

    def close(self) -> None:
        """Writes a started session to its file, removes the file of a renewed identifier, and lets the next
        request of the session start."""
        try:
            if self._renewed is not None:
                (self._sessions.directory / self._renewed).unlink(missing_ok=True)
            if self._values is not None and self._id is not None:
                file = self._sessions.directory / self._id
                # One rename publishes the file, so a reader finds the previous or the new session (HY-82).
                writing = self._sessions.directory / f'{self._id}.tmp'
                writing.write_text(json.dumps(self._values), encoding='utf-8')
                writing.replace(file)
        finally:
            if self._lock is not None:
                self._lock.release()

    def _start(self) -> dict:
        if self._values is not None:
            return self._values
        if self._cookie_id is not None:
            file = self._sessions.directory / self._cookie_id
            content = None
            try:
                if not self._sessions.expired(file):
                    content = json.loads(file.read_text(encoding='utf-8'))
            except (FileNotFoundError, json.JSONDecodeError):
                content = None
            if content is not None:
                self._id = self._cookie_id
                self._values = content
                return self._values
        self._id = secrets.token_bytes(32).hex()
        self._created = True
        self._values = {}
        return self._values
