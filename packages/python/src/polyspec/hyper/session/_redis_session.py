"""The session store of one request of the Redis sessions (HY-24, HY-45, HY-72, HY-115)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Optional

from ._record_session import RecordSession
from .session_lock_error import SessionLockError

if TYPE_CHECKING:
    from .redis_sessions import RedisSessions


class RedisSession(RecordSession):
    """The session store of one request (HY-24, HY-45, HY-72)."""

    def __init__(
        self,
        sessions: "RedisSessions",
        cookie_id: Optional[str],
        secret: Optional[str],
        record: Optional[bytes],
    ) -> None:
        super().__init__(cookie_id)
        self._sessions = sessions
        self._secret = secret
        self._record = record

    def stored(self) -> Optional[bytes]:
        return self._record

    def close(self) -> None:
        """Writes a started session, removes a renewed one and lets the next request of the session start. A request
        that lost its lock writes nothing and fails. A session that the request did not change keeps its bytes and takes
        a new expiry, as phpredis does with `session.lazy_write`."""
        sessions = self._sessions
        held = None if self._cookie_id is None else sessions._key(self._cookie_id)
        try:
            record = self.serialized()
            if record is None or self._id is None:
                return
            if held is None:
                sessions._prepare()
            key = sessions._key(self._id)
            if not self._made and record == self._read:
                sessions._command("EXPIRE", key, sessions._lifetime)
                return
            if held is not None and self._secret is not None:
                if not sessions._holds(held, self._secret):
                    raise SessionLockError(f"the lock of the session {held} expired")
            sessions._command("SETEX", key, sessions._lifetime, record)
            if self._renewed is not None:
                sessions._command("DEL", sessions._key(self._renewed))
        finally:
            if held is not None and self._secret is not None:
                sessions._release(held, self._secret)
