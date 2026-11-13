"""The session record that the PHP, Node and Python servers share, in the form `php_serialize` of PHP, and the part of a
session store that holds its values, whatever keeps the record (HY-104, HY-115)."""

from __future__ import annotations

import re
import secrets
from abc import abstractmethod
from typing import Optional

from polyspec.php_serialize import Reference, StdClass, serialize, unserialize

from .session_store import SessionStore

_IDENTIFIER = re.compile(r"[A-Za-z0-9,-]{22,128}\Z")


class RecordSession(SessionStore):
    """The values of one session in one request (HY-24, HY-45, HY-72): the record as it was read and as the request
    changed it. A value that the request did not set stays what PHP wrote, so a request that does not change it writes
    the same bytes back. A store of a request extends this class and gives the record of its session with `stored`."""

    def __init__(self, cookie_id: Optional[str]) -> None:
        self._cookie_id = cookie_id
        self._items: Optional[dict] = None
        self._read: Optional[bytes] = None
        self._id: Optional[str] = None
        self._made = False
        self._renewed: Optional[str] = None

    def created(self) -> Optional[str]:
        """Returns the identifier that this request created, which the response sets as the session cookie, or
        None."""
        return self._id if self._made else None

    @abstractmethod
    def close(self) -> None:
        """Writes the values that the request changed and releases the session; the store of the request gives it."""

    def get(self, key: str) -> object:
        return RecordSession._record_value(self._start().get(key))

    def set(self, key: str, item: object) -> None:
        self._start()[key] = RecordSession._recorded(item)

    def remove(self, key: str) -> None:
        self._start().pop(key, None)

    def renew(self) -> None:
        """Gives the values a new identifier, which the response sets as the session cookie; closing deletes the
        old session (HY-72)."""
        self._start()
        if not self._made:
            self._renewed = self._id
        self._id = secrets.token_bytes(32).hex()
        self._made = True

    def stored(self) -> Optional[bytes]:
        """Returns the record of the session of the cookie, or None when it names no session that can go on. The
        store of a request gives it."""
        raise NotImplementedError("a record session has no record of its own")

    def serialized(self) -> Optional[bytes]:
        """Returns the record to keep at closing, or None when the request did not use the session."""
        return (
            None if self._items is None or self._id is None else serialize(self._items)
        )

    @staticmethod
    def accepted(cookie: Optional[str]) -> Optional[str]:
        """Returns the value of a session cookie in the form of an identifier, or None (HY-104.9)."""
        return (
            cookie
            if cookie is not None and _IDENTIFIER.fullmatch(cookie) is not None
            else None
        )

    @staticmethod
    def cookie_name(secure: bool) -> str:
        """Returns the session cookie name: `__Host-hy-session` over HTTPS and `hy-session` otherwise (HY-45)."""
        return "__Host-hy-session" if secure else "hy-session"

    @staticmethod
    def cookie_header(id: str, secure: bool) -> str:
        """Returns the Set-Cookie value of a new session, with the attributes of the PHP session cookie (HY-45)."""
        return f"{RecordSession.cookie_name(secure)}={id}; path=/{'; secure' if secure else ''}; HttpOnly; SameSite=Lax"

    def _start(self) -> dict:
        """Returns the values of the session, which the first use of the request reads or starts."""
        if self._items is not None:
            return self._items
        record = None if self._cookie_id is None else self.stored()
        if record is not None and self._cookie_id is not None:
            self._read = record
            self._items = RecordSession._record_values(record, self._cookie_id)
            self._id = self._cookie_id
            return self._items
        self._id = secrets.token_bytes(32).hex()
        self._made = True
        self._items = {}
        return self._items

    @staticmethod
    def _record_key(key: object) -> object:
        """Returns the key of the data model of an array key: an integer is its decimal text, and bytes that are not
        UTF-8 stay bytes (HY-104.13)."""
        return str(key) if isinstance(key, int) else key

    @staticmethod
    def _record_value(stored: object) -> object:
        """Returns the value of the data model of a value that a record holds. A `stdClass` is a map and a reference
        is its value; bytes that are not UTF-8 and a number outside the data model stay what they are, and the
        application fails on them as on any other value (HY-104.13)."""
        if isinstance(stored, Reference):
            return RecordSession._record_value(stored.value)
        if isinstance(stored, StdClass):
            stored = stored.properties
        if isinstance(stored, dict):
            return {
                RecordSession._record_key(key): RecordSession._record_value(item)
                for key, item in stored.items()
            }
        if isinstance(stored, list):
            return [RecordSession._record_value(item) for item in stored]
        return stored

    @staticmethod
    def _recorded(input: object) -> object:
        """Returns what the record holds for a value of the data model. A PHP array cannot tell an empty map or a map
        with the keys 0 to n-1 from a list, so such a map is a `stdClass`, which PHP reads as a map of the data model
        (HY-104.14). A value outside the data model fails here, in the request that stores it."""
        if isinstance(input, list):
            return [RecordSession._recorded(item) for item in input]
        if isinstance(input, dict):
            items = {}
            for key, item in input.items():
                if not isinstance(key, str):
                    raise TypeError("a session map has a key that is not a string")
                items[key] = RecordSession._recorded(item)
            if list(items) == [str(index) for index in range(len(items))]:
                return StdClass(items)
            return items
        if input is None or isinstance(
            input, (bool, int, float, str, bytes, StdClass, Reference)
        ):
            return input
        raise TypeError("a session value is outside the data model")

    @staticmethod
    def _record_values(record: bytes, id: str) -> dict:
        """Returns the values of a session record by name. A record without bytes is an empty session, as PHP creates
        it, and any other record that is no array fails the request (HY-104.8)."""
        if record == b"":
            return {}
        stored = unserialize(record)
        if isinstance(stored, list):
            stored = dict(enumerate(stored))
        if not isinstance(stored, dict):
            raise ValueError(f"the session of {id} holds no map of values")
        return {RecordSession._record_key(key): item for key, item in stored.items()}
