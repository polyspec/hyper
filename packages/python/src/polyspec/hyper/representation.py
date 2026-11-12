"""The response of a representation handler (HY-122): a status, a body that is a value of the data model or None for
no body, and headers. The server checks the response (HY-122) before it sends it."""

from __future__ import annotations

from typing import Optional


class Representation:
    """What a representation handler returns."""

    status: int
    body: object
    headers: dict[str, str]

    def __init__(
        self,
        status: int,
        body: object = None,
        headers: Optional[dict[str, str]] = None,
    ):
        self.status = status
        self.body = body
        self.headers = dict(headers or {})
