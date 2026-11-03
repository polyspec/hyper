"""Sessions in a Redis server, with the protocol of phpredis 6.3.0, for a server process (HY-115). A session is the key
`PHPREDIS_SESSION:<id>`, whose bytes are the `php_serialize` record of its values and which expires after the lifetime,
so the PHP, Node and Python servers that share the Redis server share its sessions. A request holds the lock
`<key>_LOCK`, which SET NX PX takes, from its opening to its closing, so the requests of one session run one after
another in every process. A lock expires, so a holder checks it before it writes and writes nothing when it lost it."""

from __future__ import annotations

import os
import secrets
import socket
import time
from typing import Callable, Optional

from .session_record import RecordSession, _accepted

_RELEASE = (
    'if redis.call("get",KEYS[1]) == ARGV[1] then return redis.call("del",KEYS[1]) '
    "else return 0 end"
)


# One command of a Redis server: it takes the words and returns a bulk string as bytes, as `execute_command` of `redis.Redis`
# does with `decode_responses=False`.
RedisCommand = Callable[..., object]


class SessionLockError(RuntimeError):
    """A request could not take the lock of its session, or lost it before it wrote the session (HY-43, HY-115)."""


class RedisSessions:
    """Opens one session store per request (HY-115). `lock_expire`, `lock_retries` and `lock_wait` have the meaning of
    `redis.session.lock_expire`, `redis.session.lock_retries` and `redis.session.lock_wait_time` of phpredis, in seconds;
    every server of one Redis server gives them the same values, and `lock_expire` is longer than any request."""

    def __init__(
        self,
        command: RedisCommand,
        lifetime: int = 1440,
        prefix: str = "PHPREDIS_SESSION:",
        lock_expire: int = 30,
        lock_retries: int = 100,
        lock_wait: float = 0.02,
    ):
        if lifetime <= 0:
            raise ValueError("session lifetime must be a positive number of seconds")
        if lock_expire <= 0:
            raise ValueError("session lock_expire must be a positive number of seconds")
        self.command = command
        self.lifetime = lifetime
        self.prefix = prefix
        self.lock_expire = lock_expire
        self.lock_retries = lock_retries
        self.lock_wait = lock_wait

    def _open(self, cookie: Optional[str]) -> "RedisSession":
        """Returns the store of a request with the value of its session cookie; it holds the lock of the session until
        `close`. An identifier in another form or without a key names no session (HY-45)."""
        identifier = _accepted(cookie)
        if identifier is None:
            return RedisSession(self, None, None, None)
        key = self._key(identifier)
        if not self.command("EXISTS", key):
            return RedisSession(self, None, None, None)
        secret = self._lock(key)
        try:
            record = self.command("GET", key)
            if record is None:
                self._release(key, secret)
                return RedisSession(self, None, None, None)
            if not isinstance(record, bytes):
                raise TypeError(
                    "the Redis command must return bytes, as redis.Redis does with decode_responses=False"
                )
        except BaseException:
            self._release(key, secret)
            raise
        return RedisSession(self, identifier, secret, record)

    def _key(self, identifier: str) -> str:
        """Returns the key of the session of an identifier."""
        return f"{self.prefix}{identifier}"

    def _lock(self, key: str) -> str:
        """Takes the lock of a session and returns its secret. Each lock has a secret of its own, so a thread of this
        process cannot release the lock that another thread of it took after its own expired."""
        secret = f"{socket.gethostname()}|{os.getpid()}|{secrets.token_hex(8)}"
        for attempt in range(self.lock_retries + 1):
            if self.command(
                "SET", f"{key}_LOCK", secret, "NX", "PX", self.lock_expire * 1000
            ):
                return secret
            if attempt < self.lock_retries:
                time.sleep(self.lock_wait)
        raise SessionLockError(f"the lock of the session {key} was not free")

    def _holds(self, key: str, secret: str) -> bool:
        """Returns True while the lock of a session is the lock with this secret."""
        return self.command("GET", f"{key}_LOCK") == secret.encode()

    def _release(self, key: str, secret: str) -> None:
        """Releases the lock of a session unless another request holds it now."""
        self.command("EVAL", _RELEASE, 1, f"{key}_LOCK", secret)


class RedisSession(RecordSession):
    """The session store of one request (HY-24, HY-45, HY-72)."""

    def __init__(
        self,
        sessions: RedisSessions,
        identifier: Optional[str],
        secret: Optional[str],
        record: Optional[bytes],
    ):
        super().__init__(identifier)
        self._sessions = sessions
        self._secret = secret
        self._record_read = record

    def _stored(self) -> Optional[bytes]:
        return self._record_read

    def _close(self) -> None:
        """Writes a started session, removes a renewed one and lets the next request of the session start. A request
        that lost its lock writes nothing and fails. A session that the request did not change keeps its bytes and takes
        a new expiry, as phpredis does with `session.lazy_write`."""
        sessions = self._sessions
        held = None if self._cookie_id is None else sessions._key(self._cookie_id)
        try:
            record = self._serialized()
            if record is None or self._id is None:
                return
            if held is not None and self._secret is not None:
                if not sessions._holds(held, self._secret):
                    raise SessionLockError(f"the lock of the session {held} expired")
            key = sessions._key(self._id)
            if not self._made and record == self._read:
                sessions.command("EXPIRE", key, sessions.lifetime)
            else:
                sessions.command("SETEX", key, sessions.lifetime, record)
            if self._renewed is not None:
                sessions.command("DEL", sessions._key(self._renewed))
        finally:
            if held is not None and self._secret is not None:
                sessions._release(held, self._secret)
