"""The session store of one request of the file sessions (HY-24, HY-45, HY-72, HY-104): the record session of the
file store of the session-store library, whose values this class gives and takes as values of the data model."""

from __future__ import annotations

from typing import Callable, Optional, TypeVar

import polyspec.session_store as library

from ..app._core_rules import core_rules
from .session_store import SessionStore

T = TypeVar("T")

# The prefix of the names of the category classes of the session-store package, such as `SessionStoreStoreError`.
_LIBRARY_PREFIX = "SessionStore"


def converted(call: Callable[[], T]) -> T:
    """Runs a call of the session-store library. A failure of the library is raised as the error of hyper of the same
    role, with its kind, status and message (HY-132.3); any other failure is raised as it is."""
    try:
        return call()
    except Exception as error:  # noqa: BLE001 - every failure is converted or raised again
        own = core_rules().library_error(library, _LIBRARY_PREFIX, error)
        if own is error:
            raise
        raise own from error


class FileSession(SessionStore):
    """The session store of one request (HY-24, HY-45, HY-72)."""

    def __init__(self, session: library.FileSession) -> None:
        self._session = session
        # The identifier that the close wrote for a new session, which the response sets as the session cookie.
        self._made: Optional[str] = None

    def get(self, key: str) -> object:
        """Returns the value of a key as a value of the data model (HY-104.13), or None for a key that holds no
        value."""
        record = converted(lambda: self._session.get(key))
        return None if record is None else core_rules().session_value(record)

    def set(self, key: str, item: object) -> None:
        """Stores a value of the data model as the PHP value of the record (HY-104.14)."""
        record = core_rules().session_record(item)
        converted(lambda: self._session.set(key, record))

    def remove(self, key: str) -> None:
        converted(lambda: self._session.remove(key))

    def renew(self) -> None:
        """Gives the values a new identifier, which the response sets as the session cookie; closing deletes the old
        session (HY-72)."""
        converted(self._session.renew)

    def close(self) -> None:
        """Writes the values that the request changed, releases the lock of the session and its turn, and keeps the
        identifier that the store wrote for a new session."""
        self._made = converted(self._session.close)

    def created(self) -> Optional[str]:
        """Returns the identifier that this request created, which the response sets as the session cookie, or None.
        It is known after the close."""
        return self._made
