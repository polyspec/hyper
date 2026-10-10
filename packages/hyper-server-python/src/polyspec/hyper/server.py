"""Serves an application over `http.server` with sessions in files: every request of the socket server goes to
`App.respond`, as the Node server serves an application over `node:http` (HY-54), through the request hook `around`
when the application gives one (HY-97), and the write hook `written` reports every response whose write ended or
failed (HY-99). A request that answers a body larger than the body limit reads no more of
it (HY-59), a new session sets its cookie first (HY-45), a response whose write fails because the client closed the
connection is reported to the disconnect hook (HY-67), and a GET or HEAD request whose path names a file of the
public directory receives the file, as the PHP built-in server serves its document root."""

from __future__ import annotations

import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable, Optional

from .app import App
from .file_sessions import FileSessions
from .pipeline import CLOSED, CONTENT_TYPES, answer_with, cookie_values, public_file, read_limited, reported, validate
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
    reports that it did not end, before the disconnect hook (HY-99, HY-67)."""
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
            file = None if public is None else public_file(public, self.command, self.path)
            if file is not None:
                self.send_file(file)
                return
            body, size = self.read_body(application.body_limit)
            request = Request(self.command, Request.target_path(self.path), _headers(self.headers),
                              Request.target_query(self.path), body, cookies=cookie_values(self.headers.get('Cookie')),
                              https=application.https, body_size=size)
            response, answered = answer_with(application, session_store, around, request, started)
            try:
                self.send(response)
            except CLOSED:
                # HY-67: the write of the response failed because the client closed the connection; HY-99: the
                # write hook runs before the disconnect hook.
                self.close_connection = True
                reported(written, request, response, False, started)
                if answered:
                    application.disconnected(answered[0][0], started, answered[0][1])
                return
            reported(written, request, response, True, started)

        def read_body(self, limit: int) -> tuple[bytes, int]:
            """Reads the request body and its size. A body larger than the limit gives no bytes and the size read
            so far; the rest of it is read and discarded, so that the response can be sent (HY-59)."""
            declared = self.headers.get('Content-Length') or ''
            length = int(declared) if declared.isdigit() else 0
            return read_limited(self.rfile.read, limit, length)

        def send(self, response: Response) -> None:
            empty = response.status in (204, 304)
            self.send_response(response.status)
            for name, value in response.headers.items():
                for item in (value if isinstance(value, list) else [value]):
                    self.send_header(name, item)
            body = b'' if empty else response.body.encode('utf-8')
            if not empty:
                self.send_header('Content-Length', str(len(body)))
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
