"""The session store of one request of the file sessions (HY-24, HY-45, HY-72, HY-104): the record session of the
file store of the session-store library, whose values this class gives and takes as values of the data model."""

from __future__ import annotations

from typing import Callable, Optional, TypeVar

import polyspec.session_store as library

from .session_store import SessionStore

T = TypeVar("T")

# The prefix of the names of the category classes of the session-store package, such as `SessionStoreStoreError`.
_LIBRARY_PREFIX = "SessionStore"


class FileSession(SessionStore):
    """The session store of one request (HY-24, HY-45, HY-72)."""

    def __init__(self, session: library.FileSession | library.RedisSession) -> None:
        self._session = session
        # The identifier that the close wrote for a new session, which the response sets as the session cookie.
        self._made: Optional[str] = None

    @staticmethod
    def converted(call: Callable[[], T]) -> T:
        """Runs a call of the session-store library. A failure of the library is raised as the error of hyper of the same
        role, with its kind, status and message (HY-133.3); any other failure is raised as it is."""
        try:
            return call()
        # Every failure is converted or raised again.
        except Exception as error:
            own = FileSession._library_error(library, _LIBRARY_PREFIX, error)
            if own is error:
                raise
            raise own from error

    @staticmethod
    def _library_error(
        library: object, prefix: str, error: BaseException
    ) -> BaseException:
        """The error of hyper for an error of a library that hyper uses (HY-133.3), or the error as it is. An error
        of a library is an instance of a class that the error module of the library, `library`, defines. The class of
        hyper is the class of the binding of hyper of the same role: the class of the same name, such as
        `RecordError`, or the category class, whose name has `Hyper` where the category class of the library has
        `prefix`. The error of hyper has the message, the kind, the status and the errno of the error of the library,
        so no kind and no category is listed here; a class of the library without a class of hyper of its role is
        tried by its parent class, and an error that the class of hyper refuses, because the contract of hyper does
        not list its kind, stays as it is."""
        from .._binding import _errors as own

        for cls in type(error).__mro__:
            name = cls.__name__
            if getattr(library, name, None) is not cls:
                continue
            role = getattr(
                own,
                f"Hyper{name[len(prefix) :]}" if name.startswith(prefix) else name,
                None,
            )
            if not isinstance(role, type):
                continue
            try:
                converted = role(
                    str(error),
                    getattr(error, "kind", None),
                    getattr(error, "status", None),
                    getattr(error, "errno", None),
                )
            except TypeError, ValueError:
                return error
            converted.__cause__ = error
            return converted
        return error

    def get(self, key: str) -> object:
        """Returns the value of a key as a value of the data model (HY-104.13), or None for a key that holds no
        value."""
        record = FileSession.converted(lambda: self._session.get(key))
        from .._binding import _root

        return None if record is None else _root.session_value(record)

    def set(self, key: str, item: object) -> None:
        """Stores a value of the data model as the PHP value of the record (HY-104.14)."""
        from .._binding import _root

        record = _root.session_record(item)
        FileSession.converted(lambda: self._session.set(key, record))

    def remove(self, key: str) -> None:
        FileSession.converted(lambda: self._session.remove(key))

    def renew(self) -> None:
        """Gives the values a new identifier, which the response sets as the session cookie; closing deletes the old
        session (HY-72)."""
        FileSession.converted(self._session.renew)

    def close(self) -> None:
        """Writes the values that the request changed, releases the lock of the session and its turn, and keeps the
        identifier that the store wrote for a new session."""
        self._made = FileSession.converted(self._session.close)

    def created(self) -> Optional[str]:
        """Returns the identifier that this request created, which the response sets as the session cookie, or None.
        It is known after the close."""
        return self._made
