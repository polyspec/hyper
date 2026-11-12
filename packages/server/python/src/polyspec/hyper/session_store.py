"""The interface of a session store (HY-104)."""

from __future__ import annotations

from typing import Protocol


class SessionStore(Protocol):
    """Stores values that belong to one browser session."""

    def get(self, key: str) -> object: ...

    def set(self, key: str, value: object) -> None: ...

    def remove(self, key: str) -> None: ...

    def renew(self) -> None: ...
