# The steps of contracts/redis-sessions.json (HY-115): the requests of a store of Redis sessions against a Redis server
# in memory, which records the commands that it receives, and the options that making the store refuses.
from polyspec.hyper.server.redis_sessions import RedisSessions
from polyspec.hyper.server.session_lock_error import SessionLockError

from .inputs import options_of
from .store_requests import StoreRequests

_RELEASE = (
    'if redis.call("get",KEYS[1]) == ARGV[1] then return redis.call("del",KEYS[1]) '
    "else return 0 end"
)
_OPTIONS = {"lockRetries": "lock_retries", "lockWait": "lock_wait"}
_OPEN_OPTIONS = {"lifetime": "lifetime", "lockExpire": "lock_expire"}


class _MemoryRedis:
    """The Redis server in memory of one case: its keys with their bytes, the commands that it received and the
    secrets of the locks that the store asked for. No key expires."""

    def __init__(self, keys: list, text_replies: bool) -> None:
        self.keys: dict[str, bytes] = {
            key: value.encode("latin-1") for key, value in keys
        }
        self.commands: list[list[str]] = []
        self.secrets: set[str] = set()
        self._text_replies = text_replies

    def command(self, name: str, *args: object) -> object:
        words = [name, *(_MemoryRedis._word(item) for item in args)]
        self.commands.append(words)
        key = words[1] if len(words) > 1 else ""
        if name == "EXISTS" and len(words) == 2:
            return int(key in self.keys)
        if name == "GET" and len(words) == 2:
            held = self.keys.get(key)
            return (
                held.decode("utf-8")
                if self._text_replies and held is not None
                else held
            )
        if name == "SET" and len(words) == 6 and words[3:5] == ["NX", "PX"]:
            if key.endswith("_LOCK"):
                self.secrets.add(words[2])
            if key in self.keys:
                return None
            self.keys[key] = _MemoryRedis._stored(args[1])
            return "OK"
        if name == "SETEX" and len(words) == 4:
            self.keys[key] = _MemoryRedis._stored(args[2])
            return "OK"
        if name == "EXPIRE" and len(words) == 3:
            return int(key in self.keys)
        if name == "DEL" and len(words) == 2:
            return int(self.keys.pop(key, None) is not None)
        if name == "EVAL" and len(words) == 5 and words[1:3] == [_RELEASE, "1"]:
            if self.keys.get(words[3]) != _MemoryRedis._stored(args[3]):
                return 0
            del self.keys[words[3]]
            return 1
        raise LookupError(f"the store sent the command {' '.join(words)}")

    def set_key(self, key: str, value: str) -> None:
        """Writes a key directly, as another holder does; it is no received command."""
        self.keys[key] = value.encode("latin-1")

    def written(self, word: str) -> str:
        """A word as the case writes it: a secret and the release script have their names."""
        if word in self.secrets:
            return "<secret>"
        return "<release>" if word == _RELEASE else word

    @staticmethod
    def _word(item: object) -> str:
        return item.decode("latin-1") if isinstance(item, bytes) else str(item)

    @staticmethod
    def _stored(item: object) -> bytes:
        return item if isinstance(item, bytes) else str(item).encode("utf-8")


def cases(case) -> None:
    server = _MemoryRedis(
        case.input("keys"),
        case.has("textReplies") and case.input("textReplies") is True,
    )
    options = options_of(
        case,
        _OPTIONS,
        lambda name, value: value / 1000 if name == "lockWait" else value,
    )
    store = RedisSessions(server.command, **options)
    run = StoreRequests(store._open, _failure_class, {"setKey": server.set_key}, [])
    for step in case.input("steps"):
        run.request(step)
    case.compare("results", run.results)
    case.compare("created", run.created)
    case.compare("errors", run.errors)
    case.compare(
        "commands",
        [[server.written(word) for word in words] for words in server.commands],
    )
    case.compare(
        "stored",
        [
            [key, server.written(value.decode("latin-1"))]
            for key, value in sorted(server.keys.items())
        ],
    )


def open(case) -> None:
    """Makes the store with the options of the case and compares the message of the open error."""
    options = {}
    for name, value in case.input("options").items():
        if name not in _OPEN_OPTIONS:
            raise LookupError(f"the option {name} of the case is unknown")
        options[_OPEN_OPTIONS[name]] = value
    try:
        RedisSessions(_never, **options)
    except ValueError as error:
        if type(error) is not ValueError:
            raise
        case.compare("error", str(error))
        return
    raise LookupError("making the store did not fail")


def _never(name: str, *args: object) -> object:
    raise LookupError(f"making the store sent the command {name}")


def _failure_class(error: Exception) -> str | None:
    if isinstance(error, SessionLockError):
        return "lock"
    return "type" if type(error) is TypeError else None
