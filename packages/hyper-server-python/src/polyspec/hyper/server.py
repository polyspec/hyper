"""Serves an application over `http.server` with sessions in files: every request of the socket server goes to
`App.respond`, as the Node server serves an application over `node:http` (HY-54), through the request hook `around`
when the application gives one (HY-97), and the write hook `written` reports every response whose write ended or
failed (HY-99). A request that answers a body larger than the body limit reads no more of
it (HY-59), a new session sets its cookie first (HY-45), a response whose write fails because the client closed the
connection is reported to the disconnect hook (HY-67), and a GET or HEAD request whose path names a file of the
public directory receives the file, as the PHP built-in server serves its document root."""

from __future__ import annotations

import re
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable, Optional

from .app import App
from .file_sessions import FileSessions, cookie_header, cookie_name
from .reply import Reply
from .request import Request
from .response import Response

# The errors of a write to a connection that the client closed (HY-67).
CLOSED = (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)

CONTENT_TYPES = {'.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
                 '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
                 '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8'}
_PUBLIC_PATH = re.compile(r'^(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)+$')


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
    if files is not None and (not Path(files).is_absolute() or not Path(files).is_dir()):
        raise ValueError(f'{files} is not an absolute directory')
    if around is not None and not callable(around):
        raise ValueError('around must be a callable or None')
    if written is not None and not callable(written):
        raise ValueError('written must be a callable or None')
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
            file = None if public is None else _public_file(public, self.command, self.path)
            if file is not None:
                self.send_file(file)
                return
            body, size = self.read_body(application.body_limit)
            request = Request(self.command, Request.target_path(self.path), _headers(self.headers),
                              Request.target_query(self.path), body, cookies=_cookies(self.headers.get('Cookie')),
                              https=application.https, body_size=size)
            # The request and the reply of the last answer of the application, which the disconnect hook receives
            # (HY-67, HY-97).
            answered: list[tuple[Request, Reply]] = []

            def answer(given: Request) -> Response:
                session = session_store.open(given.cookie(cookie_name(application.https)))
                try:
                    response, reply = application.respond(given, session, started)
                finally:
                    session.close()
                answered[:] = [(given, reply)]
                created = session.created
                if created is None:
                    return response
                # A new session sets its cookie first, as PHP does when the session starts (HY-45).
                existing = response.headers.get('Set-Cookie', [])
                return Response(response.status, {**response.headers,
                                                  'Set-Cookie': [cookie_header(created, application.https),
                                                                 *(existing if isinstance(existing, list) else [])]},
                                response.body)

            response = answer(request) if around is None else around(request, answer)
            if not isinstance(response, Response):
                raise TypeError(f'around returned {type(response).__name__}, not a Response')
            try:
                self.send(response)
            except CLOSED:
                # HY-67: the write of the response failed because the client closed the connection; HY-99: the
                # write hook runs before the disconnect hook.
                self.close_connection = True
                if written is not None:
                    written(request, response, False, (_now_ns() - started) / 1e6)
                if answered:
                    application.disconnected(answered[0][0], started, answered[0][1])
                return
            if written is not None:
                # HY-99: the write of the status line, the headers and the body ended without an error.
                written(request, response, True, (_now_ns() - started) / 1e6)

        def read_body(self, limit: int) -> tuple[bytes, int]:
            """Reads the request body and its size. A body larger than the limit gives no bytes and the size read
            so far; the rest of it is read and discarded, so that the response can be sent (HY-59)."""
            declared = self.headers.get('Content-Length') or ''
            length = int(declared) if declared.isdigit() else 0
            size = 0
            body = bytearray()
            while size < length:
                chunk = self.rfile.read(min(65536, length - size))
                if not chunk:
                    break
                size += len(chunk)
                if size <= limit:
                    body.extend(chunk)
            return bytes(body), max(size, length if declared.isdigit() else 0)

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

        def send_file(self, file: Path) -> None:
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


def _cookies(header: Optional[str]) -> dict[str, str]:
    """Parses a Cookie header: values are URL-decoded and the first cookie of a name counts, as PHP reads
    `$_COOKIE`; a cookie that is not UTF-8 is ignored, because hyper does not check cookies (HY-42)."""
    cookies: dict[str, str] = {}
    if header is None:
        return cookies
    for pair in header.split(';'):
        equals = pair.find('=')
        if equals < 0:
            continue
        name = _utf8(_url_decode(pair[:equals].lstrip(' ')))
        value = _utf8(_url_decode(pair[equals + 1:]))
        if name not in (None, '') and value is not None and name not in cookies:
            cookies[name] = value
    return cookies


def _url_decode(text: str) -> bytes:
    """Decodes `+` to a space and `%XX` to its byte, as PHP urldecode does; any other `%` stays."""
    decoded = bytearray()
    index = 0
    while index < len(text):
        char = text[index]
        if char == '+':
            decoded.append(0x20)
            index += 1
        elif char == '%' and index + 2 < len(text) + 1 and _hex(text[index + 1:index + 3]):
            decoded.append(int(text[index + 1:index + 3], 16))
            index += 3
        else:
            decoded.extend(char.encode('latin-1'))
            index += 1
    return bytes(decoded)


def _hex(text: str) -> bool:
    return len(text) == 2 and all(char in '0123456789abcdefABCDEF' for char in text)


def _utf8(data: bytes) -> Optional[str]:
    try:
        return data.decode('utf-8')
    except UnicodeDecodeError:
        return None


def _public_file(files: str, method: str, target: str) -> Optional[Path]:
    """Returns the file of a GET or HEAD request path in the public directory, or None."""
    if method not in ('GET', 'HEAD'):
        return None
    path = Request.target_path(target)
    if _PUBLIC_PATH.fullmatch(path) is None:
        return None
    file = Path(files) / path.lstrip('/')
    return file if file.is_file() else None


def _now_ns() -> int:
    return time.perf_counter_ns()
