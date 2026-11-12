"""The request pipeline of the Python server, which every transport of the package serves with: the
public files, the body limit (HY-59), the session cookie of a new session first (HY-45), the
request hook `around` (HY-97), the write hook `written` (HY-99), the plain 500 of an escaped error
(HY-60) and the disconnect hook on a failed write (HY-67)."""

from __future__ import annotations

import re
import sys
import traceback
from pathlib import Path
from typing import BinaryIO, Callable, Optional

from ._exchange import Exchange
from ._file_response import FileResponse
from ._request_body import RequestBody
from .app import App
from ._record_session import RecordSession
from .file_sessions import FileSessions
from .redis_sessions import RedisSessions
from .request import Request
from .response import Response

# The errors of a write to a connection that the client closed (HY-67).
# The hook `around` (HY-97) gets the request and the function that answers it; the hook `written` (HY-99) gets the
# request, the response, whether the write ended, the elapsed milliseconds and the failure.
Around = Callable[[Request, Callable[[Request], Response]], Response]
Written = Callable[[Request, Optional[Response], bool, float, Optional[str]], None]

CLOSED = (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)

CONTENT_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
}
_PUBLIC_PATH = re.compile(r"^(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)+$")
# The size line of a chunk (RFC 9112 section 7.1): hexadecimal digits, then an optional chunk extension after `;`.
_CHUNK_SIZE = re.compile(rb"([0-9A-Fa-f]{1,15})[ \t]*(?:;[^\r\n]*)?\r\n\Z")
# The longest size line or trailer line and the most trailer lines of a body that is sent in chunks, the limits of a
# header line and of the header lines of `http.client`.
_LINE_LIMIT = 65536
_TRAILER_LIMIT = 100


def validate(
    files: Optional[str], around: Optional[Around], written: Optional[Written]
) -> None:
    """Fails for the arguments that the transports refuse: `files` names an absolute directory that
    exists, and `around` (HY-97) and `written` (HY-99) are callable or None."""
    if files is not None and (
        not Path(files).is_absolute() or not Path(files).is_dir()
    ):
        raise ValueError(f"{files} is not an absolute directory")
    if around is not None and not callable(around):
        raise ValueError("the request hook is not callable (HY-97)")
    if written is not None and not callable(written):
        raise ValueError("the write hook is not callable (HY-99)")


def header_lines(response: Response) -> list[tuple[str, str]]:
    """Returns the headers of a response as (name, value) pairs, one for each value of a header with several."""
    return [
        (name, item)
        for name, value in response.headers.items()
        for item in (value if isinstance(value, list) else [value])
    ]


def public_file(files: str, method: str, target: str) -> Optional[Path]:
    """Returns the file of a GET or HEAD request path in the public directory, or None."""
    if method not in ("GET", "HEAD"):
        return None
    path = Request.target_path(target)
    if _PUBLIC_PATH.fullmatch(path) is None:
        return None
    file = Path(files) / path.lstrip("/")
    return file if file.is_file() else None


def served_file(
    files: Optional[str], method: str, target: str
) -> Optional[FileResponse]:
    """Returns the file of the public directory that a GET or HEAD request names, with its content type, its length
    and its bytes, which are none for HEAD, or None without a public directory or such a file (HY-100)."""
    served = None if files is None else public_file(files, method, target)
    if served is None:
        return None
    data = served.read_bytes()
    return FileResponse(
        CONTENT_TYPES.get(served.suffix, "application/octet-stream"),
        len(data),
        b"" if method == "HEAD" else data,
    )


def read_body(read: Callable[[int], bytes], body: RequestBody, length: int) -> None:
    """Gives a request body of `length` bytes to `body` in chunks of at most 65536 bytes. A body that passes the
    limit is read to its end and discarded, so that the response can be sent (HY-59, HY-131.11)."""
    size = 0
    reading = True
    while size < length:
        chunk = read(min(65536, length - size))
        if not chunk:
            break
        size += len(chunk)
        if reading:
            reading = body.feed(chunk)


def read_chunks(source: BinaryIO, body: RequestBody) -> bool:
    """Gives a request body that is sent in chunks (`Transfer-Encoding: chunked`) to `body`, and returns False for a
    body that is not in that form or ends early. A chunk extension and the trailer fields are read and not used. A
    body that passes the limit is read to its end and discarded, as `read_body` does (HY-59.10)."""
    reading = True
    while True:
        line = source.readline(_LINE_LIMIT + 1)
        size = _CHUNK_SIZE.match(line)
        if size is None:
            return False
        remaining = int(size.group(1), 16)
        if remaining == 0:
            break
        while remaining > 0:
            chunk = source.read(min(65536, remaining))
            if not chunk:
                return False
            remaining -= len(chunk)
            if reading:
                reading = body.feed(chunk)
        if source.read(2) != b"\r\n":
            return False
    for _ in range(_TRAILER_LIMIT):
        line = source.readline(_LINE_LIMIT + 1)
        if line == b"\r\n":
            return True
        if not line.endswith(b"\r\n") or b":" not in line:
            return False
    return False


def head_request(
    method: str,
    target: str,
    headers: dict[str, str],
    cookies: dict[str, str],
    https: bool,
    declared: int,
) -> Request:
    """Returns the request as the transport received it before its body was read (HY-60): the target, the
    headers and the cookies of its one parse (HY-129), an empty body, and the size that the Content-Length declares."""
    return Request(
        method,
        Request.target_path(target),
        headers,
        Request.target_query(target),
        b"",
        cookies=cookies,
        https=https,
        body_size=declared,
    )


def declared_length(value: Optional[str]) -> int:
    """Returns the size that a Content-Length header declares, or 0 when it declares none or is not digits."""
    return int(value) if value is not None and value.isdigit() else 0


def escape(app: App, error: BaseException) -> Response:
    """Logs an error that escapes the answer of a request with its message (HY-43) and returns the plain 500
    that hyper writes (HY-60)."""
    app._log_failure(error)
    traceback.print_exception(type(error), error, error.__traceback__, file=sys.stderr)
    return plain_failure(app)


def plain_failure(app: App) -> Response:
    """Returns hyper's plain 500 (HY-60): the text, `Cache-Control: no-store` (HY-65) and the frame policy (HY-45)."""
    return app._frame(Response.text(500, "Internal Server Error"))


def answer_with(
    app: App,
    sessions: FileSessions | RedisSessions,
    around: Optional[Callable],
    exchange: Exchange,
) -> Response:
    """Answers the request of the exchange through the request hook `around` (HY-97) and the application:
    `around` is None or it receives the request and an `answer` function; `answer` opens the session of the
    request by its session cookie, answers with `App._respond`, closes the session and returns the response
    with the cookie of a new session first (HY-45). The reply of the last call of `answer` is kept in the
    exchange for the disconnect hook (HY-67, HY-97)."""

    def answer(given: Request) -> Response:
        session = sessions._open(given.cookie(RecordSession.cookie_name(secure)))
        try:
            response, reply = app._respond(given, session, exchange.started)
        finally:
            session.close()
        exchange.answered[:] = [(given, reply)]
        created = session.created()
        if created is None:
            return response
        # A new session sets its cookie first, as PHP does when the session starts (HY-45).
        existing = response.headers.get("Set-Cookie", [])
        return Response(
            response.status,
            {
                **response.headers,
                "Set-Cookie": [
                    RecordSession.cookie_header(created, secure),
                    *(existing if isinstance(existing, list) else []),
                ],
            },
            response.body,
        )

    request = exchange.request
    if request is None:
        raise RuntimeError("the exchange has no request to answer (HY-60)")
    # The session cookie has the name and the attributes of HTTPS when the application was opened with https or the
    # transport of the request says so, which the host states in the request that it built.
    secure = app.https or request.https
    response = answer(request) if around is None else around(request, answer)
    if not isinstance(response, Response):
        raise TypeError(f"around returned {type(response).__name__}, not a Response")
    return response
