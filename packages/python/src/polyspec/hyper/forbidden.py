"""A loader or an action raises this error to answer the request with 403 (HY-51)."""

from __future__ import annotations


class Forbidden(Exception):
    """A loader or an action raises this error to answer the request with 403 (HY-51)."""

    def __init__(self) -> None:
        super().__init__("forbidden")
