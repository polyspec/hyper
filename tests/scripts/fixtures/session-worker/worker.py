"""One Python server process over one session (tests/scripts/session-workers.mts): the arguments are the session
directory, the identifier, and `count <requests> <name>`, `hold`, `read <names as JSON>`, `write <values as JSON>`, or
`stale`, which writes after a line of its input, or `renew`. With HYPER_SESSION_REDIS, the port of a Redis server, it
keeps the session there, HYPER_SESSION_RETRIES is how often it tries a lock and HYPER_SESSION_EXPIRE when a lock
expires. HYPER_SESSION_SENTINEL names the ports of Sentinels instead, and HYPER_SESSION_TLS_CA, HYPER_SESSION_USER and
HYPER_SESSION_PASSWORD secure the connection; HYPER_SESSION_CLUSTER names the ports of nodes of a Redis Cluster."""

import json
import os
import sys

from polyspec.hyper import FileSessions, RedisSessions


def stores(directory):
    """Returns the session stores of the process."""
    port = os.environ.get("HYPER_SESSION_REDIS")
    sentinels = os.environ.get("HYPER_SESSION_SENTINEL")
    nodes = os.environ.get("HYPER_SESSION_CLUSTER")
    if port is None and sentinels is None and nodes is None:
        return FileSessions(directory)
    import redis
    from redis.cluster import ClusterNode, RedisCluster
    from redis.sentinel import Sentinel

    ca = os.environ.get("HYPER_SESSION_TLS_CA")
    secure = {
        "username": os.environ.get("HYPER_SESSION_USER"),
        "password": os.environ.get("HYPER_SESSION_PASSWORD"),
        **({} if ca is None else {"ssl": True, "ssl_ca_certs": ca}),
    }
    if nodes is not None:
        return RedisSessions(
            RedisCluster(
                startup_nodes=[
                    ClusterNode("127.0.0.1", int(item)) for item in nodes.split(",")
                ],
                socket_timeout=1,
                socket_connect_timeout=1,
                **secure,
            ).execute_command,
            lock_retries=int(os.environ.get("HYPER_SESSION_RETRIES", "1000000")),
            lock_wait=0.002,
            lock_expire=int(os.environ.get("HYPER_SESSION_EXPIRE", "30")),
        )

    client = (
        Sentinel(
            [("127.0.0.1", int(item)) for item in sentinels.split(",")],
            sentinel_kwargs={
                **secure,
                "socket_timeout": 1,
                "socket_connect_timeout": 1,
            },
            socket_timeout=1,
            socket_connect_timeout=1,
            **secure,
        ).master_for("hyper")
        if sentinels is not None
        else redis.Redis(host="127.0.0.1", port=int(port), **secure)
    )
    return RedisSessions(
        client.execute_command,
        lock_retries=int(os.environ.get("HYPER_SESSION_RETRIES", "1000000")),
        lock_wait=0.002,
        lock_expire=int(os.environ.get("HYPER_SESSION_EXPIRE", "30")),
        setup=None if sentinels is None else client.connection_pool.get_master_address,
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
