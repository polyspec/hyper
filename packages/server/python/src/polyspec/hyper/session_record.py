"""The session record that the PHP, Node and Python servers share, in the form `php_serialize` of PHP, and the part of a
session store that holds its values, whatever keeps the record (HY-104, HY-115)."""

from __future__ import annotations

import re
import secrets
from typing import Optional

from polyspec.php_serialize import Reference, StdClass, serialize, unserialize

_IDENTIFIER = re.compile(r"[A-Za-z0-9,-]{22,128}\Z")


def _accepted(cookie: Optional[str]) -> Optional[str]:
    """Returns the value of a session cookie in the form of an identifier, or None."""
    return (
        cookie
        if cookie is not None and _IDENTIFIER.fullmatch(cookie) is not None
        else None
    )


def _key(key: object) -> object:
    """Returns the key of the data model of an array key: an integer is its decimal text, and bytes that are not UTF-8
    stay bytes."""
    return str(key) if isinstance(key, int) else key


def _value(stored: object) -> object:
    """Returns the value of the data model of a value that a record holds. A `stdClass` is a map and a reference is its
    value; bytes that are not UTF-8 and a number outside the data model stay what they are, and the application fails
    on them as on any other value."""
    if isinstance(stored, Reference):
        return _value(stored.value)
    if isinstance(stored, StdClass):
        return {name: _value(item) for name, item in stored.properties.items()}
    if isinstance(stored, dict):
        return {_key(key): _value(item) for key, item in stored.items()}
    if isinstance(stored, list):
        return [_value(item) for item in stored]
    return stored


def _record(value: object) -> object:
    """Returns what the record holds for a value of the data model. A PHP array cannot tell an empty map or a map with
    the keys 0 to n-1 from a list, so such a map is a `stdClass`, which PHP reads as a map of the data model."""
    if isinstance(value, dict):
        items = {key: _record(item) for key, item in value.items()}
        if list(items) == [str(index) for index in range(len(items))]:
            return StdClass(items)
        return items
    if isinstance(value, list):
        return [_record(item) for item in value]
    return value


def _values(record: bytes, identifier: str) -> dict:
    """Returns the values of a session record by name. A record without bytes is an empty session, as PHP creates it,
    and any other record that is no array fails the request (HY-104)."""
    if record == b"":
        return {}
    stored = unserialize(record)
    if isinstance(stored, list):
        stored = dict(enumerate(stored))
    if not isinstance(stored, dict):
        raise ValueError(f"the session of {identifier} holds no map of values")
    return {_key(key): item for key, item in stored.items()}


class RecordSession:
    """The values of one session in one request (HY-24, HY-45, HY-72): the record as it was read and as the request
    changed it. A value that the request did not set stays what PHP wrote, so a request that does not change it writes
    the same bytes back."""

    def __init__(self, identifier: Optional[str]):
        self._cookie_id = identifier
        self._values: Optional[dict] = None
        self._read: Optional[bytes] = None
        self._id: Optional[str] = None
        self._made = False
        self._renewed: Optional[str] = None

    @property
    def _created(self) -> Optional[str]:
        """The identifier that this request created, which the response sets as the session cookie, or None."""
        return self._id if self._made else None

    def get(self, key: str) -> object:
        return _value(self._start().get(key))

    def set(self, key: str, value: object) -> None:
        self._start()[key] = _record(value)

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

    def _stored(self) -> Optional[bytes]:
        """Returns the record of the session of the cookie, or None when it names no session that can go on."""
        raise NotImplementedError

    def _serialized(self) -> Optional[bytes]:
        """Returns the record to keep at closing, or None when the request did not use the session."""
        return (
            None
            if self._values is None or self._id is None
            else serialize(self._values)
        )

    def _start(self) -> dict:
        if self._values is not None:
            return self._values
        record = self._stored()
        if record is not None and self._cookie_id is not None:
            self._read = record
            self._values = _values(record, self._cookie_id)
            self._id = self._cookie_id
            return self._values
        self._id = secrets.token_bytes(32).hex()
        self._made = True
        self._values = {}
        return self._values
