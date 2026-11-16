"""The body iterable of a response of the WSGI callable (HY-99, HY-100)."""

from __future__ import annotations

from typing import Optional

from ._exchange import Exchange
from ..app.app import App
from ..http.response import Response


class WsgiBody:
    """The body iterable of a response (HY-99). The write ended when the server consumed the whole iterable, and a
    server that closes it before its end reports a write that did not end. The iterable calls the write hook and then,
    when the write failed, the disconnect hook in its `close()`, which PEP 3333 requires a WSGI server to call when the
    request ends, so both hooks have run when `close()` returns; a second `close()` calls no hook (HY-67, HY-100.34,
    HY-100.35)."""

    def __init__(
        self,
        app: App,
        exchange: Exchange,
        response: Response,
        chunks: list[bytes],
        failure: Optional[str],
    ):
        self.app = app
        self.exchange = exchange
        self.response = response
        self.chunks = chunks
        self.failure = failure
        self.consumed = False
        self.done = False

    def __iter__(self):
        yield from self.chunks
        self.consumed = True

    def close(self) -> None:
        if self.done:
            return
        self.done = True
        try:
            self.exchange.report(self.response, self.consumed, self.failure)
            if not self.consumed:
                self.exchange.disconnect(self.app)
        finally:
            # HY-131.14: the files of the request are removed after its hooks returned.
            self.exchange.release()
