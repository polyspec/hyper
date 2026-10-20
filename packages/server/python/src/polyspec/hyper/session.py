"""The session stores of the server: the interface of a store and the store in memory (HY-104)."""

from __future__ import annotations

from typing import Protocol


class SessionStore(Protocol):
    """Stores values that belong to one browser session."""

    def get(self, key: str) -> object: ...

    def set(self, key: str, value: object) -> None: ...

    def remove(self, key: str) -> None: ...

    def renew(self) -> None: ...


class ArraySession:
    """Stores session values in memory for one process."""

    def __init__(self):
        self._values: dict[str, object] = {}
        self._renewals = 0

    def get(self, key: str) -> object:
        return self._values.get(key)

    def set(self, key: str, value: object) -> None:
        self._values[key] = value

    def remove(self, key: str) -> None:
        self._values.pop(key, None)

    def renew(self) -> None:
        """Counts the renewals; the values have no identifier in memory (HY-72)."""
        self._renewals += 1

    def _renewal_count(self) -> int:
        """Returns how many times the session was renewed."""
        return self._renewals
