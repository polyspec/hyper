"""The body iterable of a response of the WSGI callable (HY-99, HY-100)."""

from __future__ import annotations

from typing import Optional

from ._exchange import Exchange
from ..app.app import App
from ..http.response import Response


class WsgiBody:
    """The body iterable of a response (HY-99). The write ends when the server consumes the whole
    iterable, and a server that closes it before its end reports a write that did not end; the
    disconnect hook then runs when the request was answered by the application (HY-67)."""

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
        self.done = False

    def __iter__(self):
        yield from self.chunks
        self._finish(True)

    def close(self) -> None:
        self._finish(False)

    def _finish(self, ended: bool) -> None:
        if self.done:
            return
        self.done = True
        try:
            self.exchange.report(self.response, ended, self.failure)
            if not ended:
                self.exchange.disconnect(self.app)
        finally:
            # HY-131.14: the files of the request are removed after its hooks returned.
            self.exchange.release()
