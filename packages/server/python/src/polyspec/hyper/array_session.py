"""The session store in memory."""

from __future__ import annotations


class ArraySession:
    """Stores session values in memory for one process."""

    def __init__(self) -> None:
        self._values: dict[str, object] = {}
        self._renewed = 0

    def get(self, key: str) -> object:
        return self._values.get(key)

    def set(self, key: str, value: object) -> None:
        self._values[key] = value

    def remove(self, key: str) -> None:
        self._values.pop(key, None)

    def renew(self) -> None:
        """Counts the renewals; the values have no identifier in memory (HY-72)."""
        self._renewed += 1

    def _renewals(self) -> int:
        """Returns how many times the session was renewed."""
        return self._renewed
