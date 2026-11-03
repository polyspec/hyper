"""One Python server process over one session (tests/scripts/session-workers.mts): the arguments are the session
directory, the identifier, and `count <requests> <name>`, `hold`, `read <names as JSON>`, `write <values as JSON>`, or
`stale`, which writes after a line of its input, or `renew`. With HYPER_SESSION_REDIS, the port of a Redis server, it
keeps the session there, and HYPER_SESSION_RETRIES is how often it tries a lock."""

import json
import os
import sys

from polyspec.hyper.file_sessions import FileSessions
from polyspec.hyper.redis_sessions import RedisSessions


def stores(directory):
    """Returns the session stores of the process."""
    port = os.environ.get("HYPER_SESSION_REDIS")
    if port is None:
        return FileSessions(directory)
    import redis

    return RedisSessions(
        redis.Redis(port=int(port)).execute_command,
        lock_retries=int(os.environ.get("HYPER_SESSION_RETRIES", "1000000")),
        lock_wait=0.002,
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
                session._close()
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
        session._close()
    if command == "renew":
        print(session._created)


main(*sys.argv[1:])
