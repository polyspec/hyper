"""Sessions in a Redis server, a Redis Sentinel group or a Redis Cluster, in the form of phpredis 6.3.0, for a server
process (HY-115): the Redis store of the session-store library, whose rule the storage of a session is. A session is
the key `<prefix><id>`, whose bytes are the `php_serialize` record of its values and which expires after the
lifetime, so the PHP, Node and Python servers that share the Redis server share its sessions. A request holds the
lock `<key>_LOCK` from its opening to its closing, so the requests of one session run one after another in every
process (HY-115.3); a holder that lost its lock writes nothing (HY-115.5). A failure of the library is an error of
hyper of the same category with the kind of the library (HY-133.3)."""

from __future__ import annotations

import polyspec.session_store as library
from polyspec.session_store import Setting as RedisSetting
from polyspec.session_store import SettingCluster, SettingServer, SettingSentinel

from ._file_session import FileSession
from ._library_sessions import LibrarySessions

# The connection settings of the store (HY-115.17, HY-115.29): `SettingServer(url=...)` with a URL `redis://` or
# `rediss://` that may name an ACL user and its password, `SettingSentinel(urls=..., service=..., tls=..., user=...,
# password=...)`, whose store asks the Sentinels for the primary of `service` before each request that has a session
# (HY-115.26), or `SettingCluster(urls=..., user=..., password=...)`, whose user and password are None where the
# URLs give the credentials. Each takes `authorities`, the path of a PEM file whose authorities alone
# verify the servers of TLS, or None for the trust store of the machine. This module re-exports them, and `RedisSetting`
# is the union of the three.
__all__ = [
    "RedisSessions",
    "RedisSetting",
    "SettingCluster",
    "SettingSentinel",
    "SettingServer",
]


class RedisSessions(LibrarySessions[library.RedisSessions]):
    """Opens one session store per request (HY-115). `lock_expire` is seconds with no default, because no value is
    longer than every request of every application (HY-115.28); `lock_retries` and `lock_wait`, in microseconds, are
    `redis.session.lock_retries` and `redis.session.lock_wait_time` of phpredis (HY-115.29). Every server of one Redis
    server gives them the same values. A lifetime or a lock expiry of 0 fails with `invalid_lifetime` or
    `invalid_lock_expire`, a lock whose tries end with `lock_timeout` and a lost lock with `lock_lost`."""

    def __init__(
        self,
        setting: RedisSetting,
        *,
        lock_expire: int,
        lifetime: int = 1440,
        prefix: str = "PHPREDIS_SESSION:",
        lock_retries: int = 100,
        lock_wait: int = 20000,
    ):
        store = FileSession.converted(
            lambda: library.RedisSessions(
                setting,
                lock_expire=lock_expire,
                lifetime=lifetime,
                prefix=prefix,
                lock_retries=lock_retries,
                lock_wait=lock_wait,
            )
        )
        super().__init__(store)
