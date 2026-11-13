"""One request of a transport in the server pipeline, with its write hook and its disconnect hook (HY-60, HY-67,
HY-99)."""

from __future__ import annotations

import time
from typing import Callable, Optional

from ..form._request_body import RequestBody
from ..app.app import App
from ..http.reply import Reply
from ..http.request import Request
from ..http.response import Response


class Exchange:
    """One request of a transport in the pipeline: the request as the transport received it (HY-60), the
    reply of the last call of `answer` (HY-67) and the write hook, which receives the response of the request
    once (HY-99). `request` is None while the transport has no target to report."""

    def __init__(self, written: Optional[Callable], started: int):
        self.request: Optional[Request] = None
        # The body as the transport reads it, whose directory holds the files of a body read in chunks (HY-131).
        self.body: Optional[RequestBody] = None
        self.written = written
        self.started = started
        self.answered: list[tuple[Request, Reply]] = []
        self.reported = False

    def report(
        self, response: Optional[Response], ended: bool, failure: Optional[str] = None
    ) -> None:
        """Calls the write hook once with the response whose write started, the plain 500 of an escaped error, or None
        when the request ended before a response started (HY-99),
        whether the write ended, the elapsed milliseconds since the arrival of the request and the failure of an
        escaped error (HY-99). A request without a request to report is not reported (HY-60)."""
        if self.reported:
            return
        self.reported = True
        if self.written is not None and self.request is not None:
            self.written(
                self.request,
                response,
                ended,
                (time.perf_counter_ns() - self.started) / 1e6,
                failure,
            )

    def release(self) -> None:
        """Removes the directory of the files of the body after the hooks of the request returned (HY-131.14): through
        the request that was made with the body, and through the body itself, because the request stays the one as
        received (HY-60), made without the body, when the body was not read to its end; a second removal does
        nothing."""
        if self.request is not None:
            self.request._release()
        if self.body is not None:
            self.body.remove()

    def disconnect(self, app: App) -> None:
        """Calls the disconnect hook with the request and the reply of the last call of `answer` (HY-67)."""
        if self.answered:
            app._disconnected(self.answered[0][0], self.started, self.answered[0][1])
