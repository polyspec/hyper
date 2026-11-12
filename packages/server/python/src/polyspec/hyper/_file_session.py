"""The session store of one request of the file sessions (HY-24, HY-45, HY-72, HY-104)."""

from __future__ import annotations

import os
from typing import TYPE_CHECKING, Optional

from ._record_session import RecordSession

if TYPE_CHECKING:
    from .file_sessions import FileSessions

_OPEN = os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC


class FileSession(RecordSession):
    """The session store of one request (HY-24, HY-45, HY-72)."""

    def __init__(
        self, sessions: "FileSessions", cookie_id: Optional[str], held: Optional[int]
    ) -> None:
        super().__init__(cookie_id)
        self._sessions = sessions
        self._held = held

    def stored(self) -> Optional[bytes]:
        if self._held is None or self._sessions._expired(os.fstat(self._held).st_mtime):
            return None
        return FileSession._file_bytes(self._held)

    def close(self) -> None:
        """Writes a started session to its file, removes the file of a renewed identifier and lets the next request of
        the session start. A session that the request did not change keeps its bytes and takes a new modification
        time, as PHP does with `session.lazy_write`."""
        try:
            record = self.serialized()
            if record is None or self._id is None:
                return
            if self._made:
                self._create(self._id, record)
            elif self._held is not None:
                self._rewrite(self._held, record)
            if self._renewed is not None:
                self._sessions._file(self._renewed).unlink(missing_ok=True)
        finally:
            if self._held is not None:
                os.close(self._held)

    def _create(self, id: str, record: bytes) -> None:
        """Creates the file of a new identifier with the mode 0600; no other process knows the identifier yet."""
        descriptor = os.open(
            self._sessions._file(id), _OPEN | os.O_CREAT | os.O_EXCL, 0o600
        )
        try:
            FileSession._write_bytes(descriptor, record)
        finally:
            os.close(descriptor)

    def _rewrite(self, descriptor: int, record: bytes) -> None:
        """Writes a record over the file of the session in place, under its lock, as PHP does."""
        if record == self._read:
            os.utime(descriptor)
            return
        FileSession._write_bytes(descriptor, record)
        os.ftruncate(descriptor, len(record))

    @staticmethod
    def _file_bytes(descriptor: int) -> bytes:
        """Returns the bytes of an open session file from its start."""
        chunks = []
        offset = 0
        while chunk := os.pread(descriptor, 1 << 20, offset):
            chunks.append(chunk)
            offset += len(chunk)
        return b"".join(chunks)

    @staticmethod
    def _write_bytes(descriptor: int, record: bytes) -> None:
        """Writes the bytes of a record at the start of an open session file."""
        view = memoryview(record)
        offset = 0
        while offset < len(view):
            offset += os.pwrite(descriptor, view[offset:], offset)
