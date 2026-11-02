"""One Python server process over one session (tests/scripts/session-shared.test.mts): the arguments are the session
directory, the identifier, and `count <requests> <name>`, `hold`, `read <names as JSON>` or `write <values as JSON>`."""

import json
import sys

from polyspec.hyper.file_sessions import FileSessions


def canonical(value):
    """Returns the value as JSON of the test: a map as {"map": [[key, value], ...]}, whatever server wrote it."""
    if isinstance(value, dict):
        return {"map": [[key, canonical(item)] for key, item in value.items()]}
    if isinstance(value, list):
        return [canonical(item) for item in value]
    return value


def main(directory, identifier, command, first=None, second=None):
    sessions = FileSessions(directory)
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


main(*sys.argv[1:])
