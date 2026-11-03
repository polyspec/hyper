# The session store of a Redis server against a server in memory (HY-115): which commands it sends and what it keeps when
# the lock is taken or lost. tests/scripts/session-shared-redis.test.mts checks it on a real Redis server with PHP.
import unittest

from polyspec.hyper.redis_sessions import RedisSessions, SessionLockError

IDENTIFIER = "a" * 32
KEY = f"PHPREDIS_SESSION:{IDENTIFIER}"
LOCK = f"{KEY}_LOCK"
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
        self.sessions = RedisSessions(
            self.server.command, lock_retries=2, lock_wait=0.001
        )

    def test_a_request_that_finds_the_lock_taken_fails_and_changes_nothing(
        self,
    ) -> None:
        self.server.keys[LOCK] = b"another holder"
        with self.assertRaises(SessionLockError):
            self.sessions._open(IDENTIFIER)
        self.assertEqual(3, self.server.commands.count("SET"))
        self.assertEqual(RECORD, self.server.keys[KEY])
        self.assertEqual(b"another holder", self.server.keys[LOCK])

    def test_a_request_that_lost_its_lock_writes_nothing_and_fails(self) -> None:
        session = self.sessions._open(IDENTIFIER)
        session.set("n", 1)
        self.server.keys[LOCK] = b"another holder"
        with self.assertRaises(SessionLockError):
            session._close()
        self.assertEqual(RECORD, self.server.keys[KEY])
        self.assertEqual(b"another holder", self.server.keys[LOCK])

    def test_a_request_that_changed_nothing_sets_only_a_new_expiry(self) -> None:
        session = self.sessions._open(IDENTIFIER)
        self.assertEqual(0, session.get("n"))
        session._close()
        self.assertEqual(
            ["EXISTS", "SET", "GET", "GET", "EXPIRE", "EVAL"], self.server.commands
        )
        self.assertNotIn(LOCK, self.server.keys)

    def test_a_reply_that_is_not_bytes_fails_and_releases_the_lock(self) -> None:
        def text(name: str, *args: object) -> object:
            reply = self.server.command(name, *args)
            return reply.decode() if name == "GET" and reply == RECORD else reply

        with self.assertRaises(TypeError):
            RedisSessions(text)._open(IDENTIFIER)
        self.assertNotIn(LOCK, self.server.keys)
