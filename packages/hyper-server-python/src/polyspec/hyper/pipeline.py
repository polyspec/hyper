"""The request pipeline of the Python server, which every transport of the package serves with: the
public files, the body limit (HY-59), the session cookie of a new session first (HY-45), the
request hook `around` (HY-97), the write hook `written` (HY-99) and the disconnect hook on a
failed write (HY-67)."""

from __future__ import annotations

import re
import time
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


def answer_with(app: App, sessions: FileSessions, around: Optional[Callable], request: Request,
                started: int) -> tuple[Response, list[tuple[Request, Reply]]]:
    """Answers a request through the request hook `around` (HY-97) and the application: `around` is
    None or it receives the request and an `answer` function; `answer` opens the session of the
    request by its session cookie, answers with `App.respond`, closes the session and returns the
    response with the cookie of a new session first (HY-45). Returns the response to send and the
    request and the reply of the last call of `answer`, which the disconnect hook receives
    (HY-67, HY-97)."""
    answered: list[tuple[Request, Reply]] = []

    def answer(given: Request) -> Response:
        session = sessions.open(given.cookie(cookie_name(app.https)))
        try:
            response, reply = app.respond(given, session, started)
        finally:
            session.close()
        answered[:] = [(given, reply)]
        created = session.created
        if created is None:
            return response
        # A new session sets its cookie first, as PHP does when the session starts (HY-45).
        existing = response.headers.get('Set-Cookie', [])
        return Response(response.status, {**response.headers,
                                          'Set-Cookie': [cookie_header(created, app.https),
                                                         *(existing if isinstance(existing, list) else [])]},
                        response.body)

    response = answer(request) if around is None else around(request, answer)
    if not isinstance(response, Response):
        raise TypeError(f'around returned {type(response).__name__}, not a Response')
    return response, answered


def reported(written: Optional[Callable], request: Request, response: Response, ended: bool,
             started: int) -> None:
    """Calls the write hook `written` (HY-99) with whether the write of the response ended and the
    elapsed milliseconds since the arrival of the request."""
    if written is not None:
        written(request, response, ended, (time.perf_counter_ns() - started) / 1e6)


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
