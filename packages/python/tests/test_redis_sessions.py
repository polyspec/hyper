# The setup of the session store of a Redis server, against a server in memory (HY-115): when it runs and what a
# failing setup does. The cases of contracts/redis-sessions.json state the commands and the lock of a request, and
# tests/scripts/session-shared-redis.test.mts checks the store on a real Redis server with PHP.
import unittest

from polyspec.hyper.redis_sessions import RedisSessions

IDENTIFIER = "a" * 32
KEY = f"PHPREDIS_SESSION:{IDENTIFIER}"
RECORD = b'a:1:{s:1:"n";i:0;}'


class Server:
    """The commands of the session store on a dictionary, and the commands that it received."""

    def __init__(self):
        self.keys: dict[str, bytes] = {KEY: RECORD}
        self.commands: list[str] = []

    def command(self, name: str, *args: object) -> object:
        self.commands.append(name)
        key = str(args[0])
        if name == "EXISTS":
            return int(key in self.keys)
        if name == "GET":
            return self.keys.get(key)
        if name == "SET":
            if key in self.keys:
                return None
            self.keys[key] = str(args[1]).encode()
            return True
        if name == "SETEX":
            self.keys[key] = args[2]
            return True
        if name == "EXPIRE":
            return 1
        if name == "DEL":
            return int(self.keys.pop(key, None) is not None)
        if name == "EVAL":
            key = str(args[2])
            if self.keys.get(key) != str(args[3]).encode():
                return 0
            del self.keys[key]
            return 1
        raise AssertionError(f"the store sent {name}")


class RedisSessionsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.server = Server()

    def test_setup_runs_before_the_first_command_of_an_opened_session(self) -> None:
        calls: list[str] = []
        sessions = RedisSessions(
            self.server.command, setup=lambda: calls.append(str(self.server.commands))
        )
        sessions._open(IDENTIFIER).close()
        self.assertEqual(["[]"], calls)

    def test_setup_runs_before_a_new_session_is_written(self) -> None:
        calls: list[str] = []
        sessions = RedisSessions(
            self.server.command, setup=lambda: calls.append(str(self.server.commands))
        )
        session = sessions._open(None)
        self.assertEqual([], calls)
        session.set("n", 1)
        session.close()
        self.assertEqual(["[]"], calls)
        self.assertEqual(["SETEX"], self.server.commands)

    def test_a_request_without_a_session_does_not_run_setup(self) -> None:
        calls: list[int] = []
        sessions = RedisSessions(self.server.command, setup=lambda: calls.append(1))
        sessions._open(None).close()
        self.assertEqual([], calls)

    def test_a_setup_that_fails_fails_the_request_before_any_command(self) -> None:
        def fails() -> None:
            raise ConnectionError("no Sentinel names the primary")

        with self.assertRaises(ConnectionError):
            RedisSessions(self.server.command, setup=fails)._open(IDENTIFIER)
        self.assertEqual([], self.server.commands)
