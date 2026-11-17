"""One Python server process over one session (tests/scripts/session-workers.mts): the arguments are the session
directory, the identifier, and `count <requests> <name>`, `hold`, `read <names as JSON>`, `write <values as JSON>`, or
`stale`, which writes after a line of its input, or `renew`. With HYPER_SESSION_REDIS, the port of a Redis server, it
keeps the session there, HYPER_SESSION_RETRIES is how often it tries a lock and HYPER_SESSION_EXPIRE when a lock
expires. HYPER_SESSION_SENTINEL names the ports of Sentinels instead, and HYPER_SESSION_TLS_CA, HYPER_SESSION_USER and
HYPER_SESSION_PASSWORD secure the connection; HYPER_SESSION_CLUSTER names the ports of nodes of a Redis Cluster."""

import json
import os
import sys

from urllib.parse import quote

from polyspec.hyper import (
    FileSessions,
    RedisSessions,
    SettingCluster,
    SettingSentinel,
    SettingServer,
)


def stores(directory):
    """Returns the session stores of the process. The Redis store of the session-store library keeps its own
    connections; HYPER_SESSION_TLS_CA turns TLS on and is the file of the authorities that the store trusts."""
    port = os.environ.get("HYPER_SESSION_REDIS")
    sentinels = os.environ.get("HYPER_SESSION_SENTINEL")
    nodes = os.environ.get("HYPER_SESSION_CLUSTER")
    if port is None and sentinels is None and nodes is None:
        return FileSessions(directory)
    # The file of the authority of the test, which the store trusts alone (SR-6.7 of session-store), or None.
    authorities = os.environ.get("HYPER_SESSION_TLS_CA")
    tls = authorities is not None
    user = os.environ.get("HYPER_SESSION_USER")
    password = os.environ.get("HYPER_SESSION_PASSWORD")

    def url(item: str) -> str:
        """The URL of a node: the scheme `rediss` for TLS and the ACL user and its password in its user information."""
        credentials = (
            ""
            if user is None and password is None
            else f"{quote(user or '', safe='')}:{quote(password or '', safe='')}@"
        )
        return f"{'rediss' if tls else 'redis'}://{credentials}127.0.0.1:{item}"

    if nodes is not None:
        setting = SettingCluster(
            urls=[url(item) for item in nodes.split(",")],
            user=None,
            password=None,
            authorities=authorities,
        )
    elif sentinels is not None:
        setting = SettingSentinel(
            urls=[f"redis://127.0.0.1:{item}" for item in sentinels.split(",")],
            service="hyper",
            tls=tls,
            user=user,
            password=password,
            authorities=authorities,
        )
    else:
        setting = SettingServer(url=url(port), authorities=authorities)
    return RedisSessions(
        setting,
        lock_retries=int(os.environ.get("HYPER_SESSION_RETRIES", "1000000")),
        lock_wait=2000,
        lock_expire=int(os.environ.get("HYPER_SESSION_EXPIRE", "30")),
    )


def canonical(value):
    """Returns the value as JSON of the test: a map as {"map": [[key, value], ...]}, whatever server wrote it."""
    if isinstance(value, dict):
        return {"map": [[key, canonical(item)] for key, item in value.items()]}
    if isinstance(value, list):
        return [canonical(item) for item in value]
    return value


def main(directory, identifier, command, first=None, second=None):
    sessions = stores(directory)
    if command == "count":
        for _ in range(int(first)):
            session = sessions._open(identifier)
            try:
                session.set("n", session.get("n") + 1)
                session.set(second, (session.get(second) or 0) + 1)
            finally:
                session.close()
        return
    session = sessions._open(identifier)
    if command == "hold":
        session.get("n")
        print("held", flush=True)
        sys.stdin.read()
    if command == "stale":
        session.set("stale", 1)
        print("held", flush=True)
        sys.stdin.readline()
    if command == "renew":
        session.renew()
    try:
        if command == "read":
            print(
                json.dumps([canonical(session.get(name)) for name in json.loads(first)])
            )
        elif command == "write":
            for name, value in json.loads(first).items():
                session.set(name, value)
    finally:
        session.close()
    if command == "renew":
        print(session.created())


main(*sys.argv[1:])
