"""The session of the record tests, whose record is fixed bytes (HY-104.13, HY-104.48)."""

from __future__ import annotations

from typing import Optional

from polyspec.hyper.session._record_session import RecordSession


class FixedSession(RecordSession):
    """A session whose record is the given bytes, as a store of a request gives it."""

    def __init__(self, record: bytes) -> None:
        super().__init__("a" * 32)
        self._record = record

    def stored(self) -> Optional[bytes]:
        return self._record

    def close(self) -> None:
        pass
