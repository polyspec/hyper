"""Serves an application over `http.server` with sessions in files: every request of the socket server goes to
`App._respond`, as the Node server serves an application over `node:http` (HY-54), through the request hook `around`
when the application gives one (HY-97), and the write hook `written` reports every response whose write ended or
failed (HY-99). A request that answers a body larger than the body limit reads no more of
it (HY-59), a new session sets its cookie first (HY-45), a response whose write fails because the client closed the
connection is reported to the disconnect hook (HY-67), an error that escapes the answer gets the plain 500 of hyper
(HY-60), and a GET or HEAD request whose path names a file of the public directory receives the file, as the PHP
built-in server serves its document root."""

from __future__ import annotations

import logging
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional

from .app import App
from ._cookies import Cookies
from .file_sessions import FileSessions
from .redis_sessions import RedisSessions
from ._pipeline import (
    Around,
    Written,
    CLOSED,
    CONTENT_TYPES,
    Exchange,
    answer_with,
    declared_length,
    head_request,
    header_lines,
    plain_500,
    public_file,
    read_body,
    validate,
)
from ._request_body import RequestBody
from .request import Request
from .response import Response

_logger = logging.getLogger(__name__)


def create_server(
    app: App,
    sessions: FileSessions | RedisSessions,
    files: Optional[str] = None,
    host: str = "127.0.0.1",
    port: int = 0,
    around: Optional[Around] = None,
    written: Optional[Written] = None,
) -> ThreadingHTTPServer:
    """Returns a server that answers every request with the application. `files` names an absolute directory of
    public files: a GET or HEAD request whose path names a file in it receives the file.

    `around` is called once for every other request with the request as the server built it and a function
    `answer(request)` that runs the application for a request with the session of the request and returns the
    response with the cookie of a new session; the server sends the `Response` that `around` returns. `around` may
    call `answer` with a changed request, change its response or return its own response without calling it, and
    then no session is opened and no hook of the application runs (HY-97).

    `written` is called once for every request whose response the server tried to write to the connection, with the
    request that it gave to `around`, the response that it wrote, whether the write ended and the elapsed
    milliseconds since the arrival of the request; a write that failed because the client closed the connection
    reports that it did not end, before the disconnect hook (HY-99, HY-67). The plain 500 of an escaped error is
    reported the same way, with the failure of the error (HY-60, HY-99)."""
    validate(files, around, written)
    app_address = app, sessions, files

    class Handler(BaseHTTPRequestHandler):
        # A long operation prints its progress; the access log of http.server would repeat every request line.
        def log_message(self, _format: str, *_args: object) -> None:
            pass

        def do_GET(self) -> None:
            self.serve()

        def do_HEAD(self) -> None:
            self.serve()

        def do_POST(self) -> None:
            self.serve()

        def do_PUT(self) -> None:
            self.serve()

        def do_DELETE(self) -> None:
            self.serve()

        def do_PATCH(self) -> None:
            self.serve()

        def do_OPTIONS(self) -> None:
            self.serve()

        def serve(self) -> None:
            exchange = Exchange(written, _now_ns())
            try:
                self.answer(exchange)
            finally:
                # HY-131.14: the files of the request are removed after its hooks returned.
                exchange.release()

        def answer(self, exchange: Exchange) -> None:
            application, session_store, public = app_address
            self.headers_started = False
            try:
                # The request as received so far: an unread body is empty and its size is the declared one (HY-60).
                cookies = Cookies.parse(_cookie_header(self.headers))
                exchange.request = head_request(
                    self.command,
                    self.path,
                    _headers(self.headers),
                    cookies,
                    application.https,
                    declared_length(self.headers.get("Content-Length")),
                )
                file = (
                    None
                    if public is None
                    else public_file(public, self.command, self.path)
                )
                if file is not None:
                    self.send_file(file)
                    return
                # HY-131: a multipart body of an application with that form type is read in chunks into files of the
                # request.
                declared = declared_length(self.headers.get("Content-Length"))
                exchange.body = RequestBody(
                    self.headers.get("Content-Type") or "",
                    application.body_limit,
                    "multipart/form-data" in application._form_types,
                    application._value_limit,
                    application._part_limit,
                    application.file_limit,
                )
                read_body(self.rfile.read, exchange.body, declared)
                exchange.request = Request(
                    self.command,
                    Request.target_path(self.path),
                    _headers(self.headers),
                    Request.target_query(self.path),
                    exchange.body.held(),
                    cookies=cookies,
                    https=application.https,
                    body_size=max(exchange.body.size(), declared),
                    read=exchange.body,
                )
                response = answer_with(application, session_store, around, exchange)
            except Exception as error:
                # HY-60: an error that escapes the answer gets the plain 500. The answer runs the hooks of the
                # application and the session store, which are user code, so no narrower type can name every error.
                _logger.exception("hyper: %s: %s", type(error).__name__, error)
                self.escape_error(application, error, exchange, None)
                return
            try:
                self.send(response)
            except CLOSED:
                # HY-67: the write of the response failed because the client closed the connection; HY-99: the
                # write hook runs before the disconnect hook.
                self.close_connection = True
                exchange.report(response, False)
                exchange.disconnect(application)
                return
            except (OSError, ValueError) as error:
                # HY-60: a write that fails after the answer, or a header or body that cannot be encoded (a
                # UnicodeError is a ValueError), is an escaped error.
                _logger.exception("hyper: %s: %s", type(error).__name__, error)
                self.escape_error(application, error, exchange, response)
                return
            exchange.report(response, True)

        def escape_error(
            self,
            application,
            error: Exception,
            exchange: Exchange,
            started: Optional[Response],
        ) -> None:
            """Writes hyper's plain 500 for an error that escapes the answer of a request (HY-60) when no write has
            started; the caller has logged the error. `started` is the response whose write started, or None. When the headers have left the
            server, the 500 cannot be written: the connection closes and the write hook receives `started` with
            ended false. The write hook receives the plain 500 once, with the failure of the error (HY-99)."""
            response = plain_500(application)
            failure = str(error)
            if self.headers_started:
                self.close_connection = True
                exchange.report(
                    started if started is not None else response, False, failure
                )
                return
            try:
                self.send(response)
            except OSError as write_error:
                sys.stderr.write(
                    f"hyper: {type(write_error).__name__}: {write_error}\n"
                )
                self.close_connection = True
                exchange.report(response, False, failure)
                return
            exchange.report(response, True, failure)

        def end_headers(self) -> None:
            # The status line and the headers leave the server with the end of the headers (HY-60).
            self.headers_started = True
            super().end_headers()

        def send(self, response: Response) -> None:
            empty = response.status in (204, 304)
            body = b"" if empty else response.body.encode("utf-8")
            headers = header_lines(response)
            if not empty:
                headers.append(("Content-Length", str(len(body))))
            # Every header is encoded before the status line is buffered, so that a header that cannot be sent leaves
            # no partial response in the buffer of the handler (HY-60).
            for name, value in headers:
                f"{name}: {value}".encode("latin-1")
            self.send_response(response.status)
            for name, value in headers:
                self.send_header(name, value)
            self.end_headers()
            # HY-27.5: a HEAD request receives the headers, with the Content-Length of the body, and no body.
            if body and self.command != "HEAD":
                self.wfile.write(body)

        def send_file(self, file) -> None:
            size = file.stat().st_size
            self.send_response(200)
            self.send_header(
                "Content-Type",
                CONTENT_TYPES.get(file.suffix, "application/octet-stream"),
            )
            self.send_header("Content-Length", str(size))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(file.read_bytes())

    return ThreadingHTTPServer((host, port), Handler)


def _cookie_header(headers) -> Optional[bytes]:
    """Returns the `Cookie` lines of the request joined with `; ` (HY-129), or None when it has none. The header
    lines are text with one character per byte, so Latin-1 gives back their bytes."""
    lines = headers.get_all("Cookie")
    return None if lines is None else "; ".join(lines).encode("latin-1")


def _headers(headers) -> dict[str, str]:
    """Returns the request headers in lower case; a repeated header joins its values, as HTTP reads it."""
    joined: dict[str, list[str]] = {}
    for name, value in headers.items():
        joined.setdefault(name.lower(), []).append(value)
    return {name: ", ".join(values) for name, values in joined.items()}


def _now_ns() -> int:
    return time.perf_counter_ns()
