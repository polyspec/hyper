"""A loader or an action raises this error when the requested resource does not exist (HY-27)."""

from __future__ import annotations


class NotFound(Exception):
    """A loader or an action raises this error when the requested resource does not exist (HY-27)."""

    def __init__(self) -> None:
        super().__init__("not found")
