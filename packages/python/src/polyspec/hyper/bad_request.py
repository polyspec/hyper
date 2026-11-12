"""A loader or an action raises this error to answer the request with 400 (HY-58)."""

from __future__ import annotations


class BadRequest(Exception):
    """A loader or an action raises this error to answer the request with 400 (HY-58)."""

    def __init__(self) -> None:
        super().__init__("bad request")
