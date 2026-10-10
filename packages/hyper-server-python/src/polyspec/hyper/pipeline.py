"""The request pipeline of the Python server, which every transport of the package serves with: the
public files, the body limit (HY-59), the session cookie of a new session first (HY-45), the
request hook `around` (HY-97), the write hook `written` (HY-99), the plain 500 of an escaped error
(HY-60) and the disconnect hook on a failed write (HY-67)."""

from __future__ import annotations

import re
import sys
import time
import traceback
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


def validate(files: Optional[str], around: Optional[Callable], written: Optional[Callable]) -> None:
    """Fails for the arguments that the transports refuse: `files` names an absolute directory that
    exists, and `around` (HY-97) and `written` (HY-99) are callable or None."""
    if files is not None and (not Path(files).is_absolute() or not Path(files).is_dir()):
        raise ValueError(f'{files} is not an absolute directory')
    if around is not None and not callable(around):
        raise ValueError('around must be a callable or None')
    if written is not None and not callable(written):
        raise ValueError('written must be a callable or None')


def cookie_values(header: Optional[str]) -> dict[str, str]:
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


def public_file(files: str, method: str, target: str) -> Optional[Path]:
    """Returns the file of a GET or HEAD request path in the public directory, or None."""
    if method not in ('GET', 'HEAD'):
        return None
    path = Request.target_path(target)
    if _PUBLIC_PATH.fullmatch(path) is None:
        return None
    file = Path(files) / path.lstrip('/')
    return file if file.is_file() else None


def read_limited(read: Callable[[int], bytes], limit: int, length: int) -> tuple[bytes, int]:
    """Reads a request body of `length` bytes with `read` and its size. A body larger than the limit
    gives no bytes and the size read so far; the rest of it is read and discarded, so that the
    response can be sent (HY-59)."""
    size = 0
    body = bytearray()
    while size < length:
        chunk = read(min(65536, length - size))
        if not chunk:
            break
        size += len(chunk)
        if size <= limit:
            body.extend(chunk)
    return bytes(body), max(size, length)


class Exchange:
    """One request of a transport in the pipeline: the request as the transport received it (HY-60), the
    reply of the last call of `answer` (HY-67) and the write hook, which receives the response of the request
    once (HY-99). `request` is None while the transport has no target to report."""

    def __init__(self, written: Optional[Callable], started: int):
        self.request: Optional[Request] = None
        self.written = written
        self.started = started
        self.answered: list[tuple[Request, Reply]] = []
        self.reported = False

    def report(self, response: Response, ended: bool) -> None:
        """Calls the write hook once with the response that the server tried to write, whether the write
        ended and the elapsed milliseconds since the arrival of the request (HY-99). A request without a
        request to report is not reported (HY-60)."""
        if self.reported:
            return
        self.reported = True
        if self.written is not None and self.request is not None:
            self.written(self.request, response, ended, (time.perf_counter_ns() - self.started) / 1e6)

    def disconnect(self, app: App) -> None:
        """Calls the disconnect hook with the request and the reply of the last call of `answer` (HY-67)."""
        if self.answered:
            app.disconnected(self.answered[0][0], self.started, self.answered[0][1])


def head_request(method: str, target: str, headers: dict[str, str], cookie: Optional[str], https: bool,
                 declared: int) -> Request:
    """Returns the request as the transport received it before its body was read (HY-60): the target, the
    headers and the cookies, an empty body, and the size that the Content-Length declares."""
    return Request(method, Request.target_path(target), headers, Request.target_query(target), b'',
                   cookies=cookie_values(cookie), https=https, body_size=declared)


def declared_length(value: Optional[str]) -> int:
    """Returns the size that a Content-Length header declares, or 0 when it declares none or is not digits."""
    return int(value) if value is not None and value.isdigit() else 0


def escape(app: App, error: BaseException) -> Response:
    """Logs an error that escapes the answer of a request with its message (HY-43) and returns the plain 500
    that hyper writes (HY-60): the text, `Cache-Control: no-store` (HY-65) and the frame policy (HY-45)."""
    sys.stderr.write(f'hyper: {type(error).__name__}: {error}\n')
    traceback.print_exception(type(error), error, error.__traceback__, file=sys.stderr)
    response = Response.text(500, 'Internal Server Error')
    return response.with_header('Content-Security-Policy', f'frame-ancestors {app.frame_ancestors}') \
        .with_header('Cache-Control', 'no-store')


def answer_with(app: App, sessions: FileSessions, around: Optional[Callable], exchange: Exchange) -> Response:
    """Answers the request of the exchange through the request hook `around` (HY-97) and the application:
    `around` is None or it receives the request and an `answer` function; `answer` opens the session of the
    request by its session cookie, answers with `App.respond`, closes the session and returns the response
    with the cookie of a new session first (HY-45). The reply of the last call of `answer` is kept in the
    exchange for the disconnect hook (HY-67, HY-97)."""

    def answer(given: Request) -> Response:
        session = sessions.open(given.cookie(cookie_name(app.https)))
        try:
            response, reply = app.respond(given, session, exchange.started)
        finally:
            session.close()
        exchange.answered[:] = [(given, reply)]
        created = session.created
        if created is None:
            return response
        # A new session sets its cookie first, as PHP does when the session starts (HY-45).
        existing = response.headers.get('Set-Cookie', [])
        return Response(response.status, {**response.headers,
                                          'Set-Cookie': [cookie_header(created, app.https),
                                                         *(existing if isinstance(existing, list) else [])]},
                        response.body)

    request = exchange.request
    if request is None:
        raise RuntimeError('the exchange has no request to answer (HY-60)')
    response = answer(request) if around is None else around(request, answer)
    if not isinstance(response, Response):
        raise TypeError(f'around returned {type(response).__name__}, not a Response')
    return response


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
