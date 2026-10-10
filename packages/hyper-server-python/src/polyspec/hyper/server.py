"""Serves an application over `http.server` with sessions in files: every request of the socket server goes to
`App.respond`, as the Node server serves an application over `node:http` (HY-54), through the request hook `around`
when the application gives one (HY-97), and the write hook `written` reports every response whose write ended or
failed (HY-99). A request that answers a body larger than the body limit reads no more of
it (HY-59), a new session sets its cookie first (HY-45), a response whose write fails because the client closed the
connection is reported to the disconnect hook (HY-67), an error that escapes the answer gets the plain 500 of hyper
(HY-60), and a GET or HEAD request whose path names a file of the public directory receives the file, as the PHP
built-in server serves its document root."""

from __future__ import annotations

import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable, Optional

from .app import App
from .file_sessions import FileSessions
from .pipeline import CLOSED, CONTENT_TYPES, Exchange, answer_with, cookie_values, declared_length, escape, head_request, public_file, read_limited, validate
from .request import Request
from .response import Response


def create_server(app: App, sessions: FileSessions, files: Optional[str] = None, host: str = '127.0.0.1',
                  port: int = 0,
                  around: Optional[Callable[[Request, Callable[[Request], Response]], Response]] = None,
                  written: Optional[Callable[[Request, Response, bool, float], None]] = None
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
    reported the same way (HY-60)."""
    validate(files, around, written)
    app_address = app, sessions, files

    class Handler(BaseHTTPRequestHandler):
        # A long operation prints its progress; the access log of http.server would repeat every request line.
        def log_message(self, format: str, *args: object) -> None:  # noqa: A002 - the signature of the base class
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
            application, session_store, public = app_address
            started = _now_ns()
            self.headers_started = False
            exchange = Exchange(written, started)
            try:
                # The request as received so far: an unread body is empty and its size is the declared one (HY-60).
                exchange.request = head_request(self.command, self.path, _headers(self.headers), self.headers.get('Cookie'),
                                                application.https, declared_length(self.headers.get('Content-Length')))
                file = None if public is None else public_file(public, self.command, self.path)
                if file is not None:
                    self.send_file(file)
                    return
                body, size = self.read_body(application.body_limit)
                exchange.request = Request(self.command, Request.target_path(self.path), _headers(self.headers),
                                           Request.target_query(self.path), body, cookies=cookie_values(self.headers.get('Cookie')),
                                           https=application.https, body_size=size)
                response = answer_with(application, session_store, around, exchange)
            except Exception as error:
                self.write_escape(application, error, exchange)
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
            except Exception as error:
                # A send that fails before the headers leave the server is answered with the plain 500 (HY-60).
                if self.headers_started:
                    sys.stderr.write(f'hyper: {type(error).__name__}: {error}\n')
                    self.close_connection = True
                    exchange.report(response, False)
                    return
                self.write_escape(application, error, exchange)
                return
            exchange.report(response, True)

        def write_escape(self, application, error: Exception, exchange: Exchange) -> None:
            """Logs an error that escapes the answer of a request (HY-60) and writes hyper's plain 500 when the response
            has not started; the write hook receives that 500 once. When the response has started, or the 500 cannot
            be written, the connection closes."""
            response = escape(application, error)
            if self.headers_started:
                self.close_connection = True
                return
            try:
                self.send(response)
            except Exception as write_error:
                sys.stderr.write(f'hyper: {type(write_error).__name__}: {write_error}\n')
                self.close_connection = True
                exchange.report(response, False)
                return
            exchange.report(response, True)

        def end_headers(self) -> None:
            # The status line and the headers leave the server with the end of the headers (HY-60).
            self.headers_started = True
            super().end_headers()

        def read_body(self, limit: int) -> tuple[bytes, int]:
            """Reads the request body and its size. A body larger than the limit gives no bytes and the size read
            so far; the rest of it is read and discarded, so that the response can be sent (HY-59)."""
            return read_limited(self.rfile.read, limit, declared_length(self.headers.get('Content-Length')))

        def send(self, response: Response) -> None:
            empty = response.status in (204, 304)
            body = b'' if empty else response.body.encode('utf-8')
            headers = [(name, item) for name, value in response.headers.items()
                       for item in (value if isinstance(value, list) else [value])]
            if not empty:
                headers.append(('Content-Length', str(len(body))))
            # Every header is encoded before the status line is buffered, so that a header that cannot be sent leaves
            # no partial response in the buffer of the handler (HY-60).
            for name, value in headers:
                f'{name}: {value}'.encode('latin-1')
            self.send_response(response.status)
            for name, value in headers:
                self.send_header(name, value)
            self.end_headers()
            if body:
                self.wfile.write(body)

        def send_file(self, file) -> None:
            size = file.stat().st_size
            self.send_response(200)
            self.send_header('Content-Type', CONTENT_TYPES.get(file.suffix, 'application/octet-stream'))
            self.send_header('Content-Length', str(size))
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(file.read_bytes())

    return ThreadingHTTPServer((host, port), Handler)


def _headers(headers) -> dict[str, str]:
    """Returns the request headers in lower case; a repeated header joins its values, as HTTP reads it."""
    joined: dict[str, list[str]] = {}
    for name, value in headers.items():
        joined.setdefault(name.lower(), []).append(value)
    return {name: ', '.join(values) for name, values in joined.items()}


def _now_ns() -> int:
    return time.perf_counter_ns()
