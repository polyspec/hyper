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

from ._redis_session import RedisSession
from ._record_session import RecordSession
from .session_lock_error import SessionLockError

_RELEASE = (
    'if redis.call("get",KEYS[1]) == ARGV[1] then return redis.call("del",KEYS[1]) '
    "else return 0 end"
)


# One command of a Redis server: it takes the words and returns a bulk string as bytes, as `execute_command` of `redis.Redis`
# does with `decode_responses=False`.
_RedisCommand = Callable[..., object]


class RedisSessions:
    """Opens one session store per request (HY-115). `lock_expire`, `lock_retries` and `lock_wait` have the meaning of
    `redis.session.lock_expire`, `redis.session.lock_retries` and `redis.session.lock_wait_time` of phpredis, in seconds;
    every server of one Redis server gives them the same values, and `lock_expire` is longer than any request. `setup`
    runs before the first command of a request that has a session, so a client can find its server for that request."""

    _command: _RedisCommand
    _lifetime: int

    def __init__(
        self,
        command: _RedisCommand,
        lifetime: int = 1440,
        prefix: str = "PHPREDIS_SESSION:",
        lock_expire: int = 30,
        lock_retries: int = 100,
        lock_wait: float = 0.02,
        setup: Optional[Callable[[], object]] = None,
    ):
        if lifetime <= 0:
            raise ValueError("session lifetime must be a positive number of seconds")
        if lock_expire <= 0:
            raise ValueError("session lock_expire must be a positive number of seconds")
        self._command = command
        self._lifetime = lifetime
        self.prefix = prefix
        self.lock_expire = lock_expire
        self.lock_retries = lock_retries
        self.lock_wait = lock_wait
        self.setup = setup

    def _prepare(self) -> None:
        """Runs the setup of a request that is about to send its first command."""
        if self.setup is not None:
            self.setup()

    def _open(self, cookie: Optional[str]) -> "RedisSession":
        """Returns the store of a request with the value of its session cookie; it holds the lock of the session until
        `close`. An identifier in another form or without a key names no session (HY-45)."""
        identifier = RecordSession.accepted(cookie)
        if identifier is None:
            return RedisSession(self, None, None, None)
        self._prepare()
        key = self._key(identifier)
        if not self._command("EXISTS", key):
            return RedisSession(self, None, None, None)
        secret = self._take_lock(key)
        try:
            record = RedisSessions._bulk_bytes(self._command("GET", key))
            if record is None:
                self._release(key, secret)
                return RedisSession(self, None, None, None)
        except BaseException:
            self._release(key, secret)
            raise
        return RedisSession(self, identifier, secret, record)

    def _key(self, identifier: str) -> str:
        """Returns the key of the session of an identifier."""
        return f"{self.prefix}{identifier}"

    def _take_lock(self, key: str) -> str:
        """Takes the lock of a session and returns its secret. Each lock has a secret of its own, so a thread of this
        process cannot release the lock that another thread of it took after its own expired."""
        secret = f"{socket.gethostname()}|{os.getpid()}|{secrets.token_hex(8)}"
        for attempt in range(self.lock_retries + 1):
            if self._command(
                "SET", f"{key}_LOCK", secret, "NX", "PX", self.lock_expire * 1000
            ):
                return secret
            if attempt < self.lock_retries:
                time.sleep(self.lock_wait)
        raise SessionLockError(f"the lock of the session {key} was not free")

    def _holds(self, key: str, secret: str) -> bool:
        """Returns True while the lock of a session is the lock with this secret."""
        held = RedisSessions._bulk_bytes(self._command("GET", f"{key}_LOCK"))
        return held == secret.encode()

    def _release(self, key: str, secret: str) -> None:
        """Releases the lock of a session unless another request holds it now."""
        self._command("EVAL", _RELEASE, 1, f"{key}_LOCK", secret)

    @staticmethod
    def _bulk_bytes(reply: object) -> Optional[bytes]:
        """Returns a reply of a bulk string as bytes, or None. A client that returns text would change the bytes of a
        record."""
        if reply is None or isinstance(reply, bytes):
            return reply
        raise TypeError(
            "the Redis command must return bytes, as redis.Redis does with decode_responses=False"
        )
