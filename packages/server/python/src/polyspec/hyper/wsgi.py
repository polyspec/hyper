"""A WSGI application callable of the server pipeline (HY-100): a WSGI server runs the callable and
the pipeline answers every request as `create_server` does (HY-97, HY-99) — the public files, the
body limit (HY-59), the session cookie of a new session first (HY-45), the hooks and the plain 500 of
an escaped error (HY-60). The library names no server; a deployment runs the callable with the server
that it chooses."""

from __future__ import annotations

import sys
import time
from http import HTTPStatus
from typing import Callable, Optional, Union

from .app import App
from ._cookies import Cookies
from ._exchange import Exchange
from ._file_response import FileResponse
from .file_sessions import FileSessions
from .redis_sessions import RedisSessions
from ._pipeline import (
    Around,
    Written,
    CONTENT_TYPES,
    answer_with,
    declared_length,
    escape,
    head_request,
    header_lines,
    public_file,
    read_body,
    validate,
)
from ._request_body import RequestBody
from ._wsgi_body import WsgiBody
from .request import Request
from .response import Response


def create_wsgi(
    app: App,
    sessions: FileSessions | RedisSessions,
    files: Optional[str] = None,
    around: Optional[Around] = None,
    written: Optional[Written] = None,
) -> Callable[[dict, Callable], object]:
    """Returns a WSGI application callable (PEP 3333) that answers every request with the
    application, as `create_server` does (HY-100). `files`, `around` and `written` mean what they
    mean there (HY-97, HY-99): `written` reports that the write ended when the WSGI server consumed
    the whole body iterable, and that it failed when the server closed the iterable before its end,
    which PEP 3333 defines as premature termination; when the write failed, the disconnect hook runs
    with the request and the reply of the last call of `answer` (HY-67). An error before
    `start_response`, a `start_response` that raises, and a status, header or body that cannot be
    encoded are escaped errors: the plain 500 goes through `start_response` (HY-60, HY-99)."""
    validate(files, around, written)

    def application(environ: dict, start_response: Callable) -> object:
        started = time.perf_counter_ns()
        exchange = Exchange(written, started)
        # HY-27.5: a HEAD request receives the headers, with the Content-Length of the body, and no body.
        head = str(environ.get("REQUEST_METHOD", "")).upper() == "HEAD"
        try:
            result: Union[Response, FileResponse] = _answer(
                app, sessions, around, files, environ, exchange
            )
        except Exception as error:  # noqa: BLE001 - HY-60: an error that escapes the answer gets the plain 500
            return _escape(app, exchange, error, start_response, head)
        if isinstance(result, FileResponse):
            start_response(
                _status(200),
                [
                    ("Content-Type", result.content_type),
                    ("Content-Length", str(result.length)),
                ],
            )
            return [result.data]
        try:
            line, headers, encoded = _encode(result)
        except Exception as error:  # noqa: BLE001 - HY-60: a status, header or body that cannot be written is an escape
            return _escape(app, exchange, error, start_response, head)
        try:
            start_response(line, headers)
        except Exception as error:  # noqa: BLE001 - HY-60: a start_response that raises is an escape
            return _escape(app, exchange, error, start_response, head, sys.exc_info())
        return WsgiBody(app, exchange, result, [] if head else [encoded], None)

    return application


def _encode(response: Response) -> tuple[str, list[tuple[str, str]], bytes]:
    """Returns the status line, the headers and the body of a response as PEP 3333 writes them. Fails for a
    status that is not an HTTP status, a header or a value that is not latin-1, and a body that is not
    UTF-8 (HY-60)."""
    empty = response.status in (204, 304)
    encoded = b"" if empty else response.body.encode("utf-8")
    headers = header_lines(response)
    for name, value in headers:
        f"{name}: {value}".encode("latin-1")
    if not empty:
        headers.append(("Content-Length", str(len(encoded))))
    return _status(response.status), headers, encoded


def _escape(
    app: App,
    exchange: Exchange,
    error: BaseException,
    start_response: Callable,
    head: bool,
    exc_info=None,
) -> WsgiBody:
    """Answers an error that escapes the answer with the plain 500 through `start_response` (HY-60). The write hook
    receives the 500 with the failure when the server consumes its body (HY-99). A `start_response` that raises
    again reports the write as not ended and propagates."""
    response = escape(app, error)
    failure = str(error)
    line, headers, encoded = _encode(response)
    try:
        start_response(line, headers, exc_info)
    except Exception:
        try:
            exchange.report(response, False, failure)
        finally:
            exchange.release()
        raise
    return WsgiBody(app, exchange, response, [] if head else [encoded], failure)


def _answer(
    app: App,
    sessions: FileSessions | RedisSessions,
    around: Optional[Callable],
    files: Optional[str],
    environ: dict,
    exchange: Exchange,
) -> Union[Response, FileResponse]:
    """Answers the request of the environ: a file of the public directory, or the application through `around`.
    The request as received is kept in the exchange before the body is read (HY-60)."""
    # HY-100.31: the host passes the method in upper case.
    method = environ["REQUEST_METHOD"].upper()
    target = _request_target(environ)
    declared = declared_length(environ.get("CONTENT_LENGTH"))
    cookies = Cookies.parse(_cookie_header(environ))
    # The request is HTTPS when the application was opened with https or the WSGI server says so.
    https = app.https or environ.get("wsgi.url_scheme") == "https"
    exchange.request = head_request(
        method,
        target,
        _environ_headers(environ),
        cookies,
        https,
        declared,
    )
    served = None if files is None else public_file(files, method, target)
    if served is not None:
        # HY-100: the files of the public directory are served before `around`; no hook runs.
        data = served.read_bytes()
        return FileResponse(
            CONTENT_TYPES.get(served.suffix, "application/octet-stream"),
            len(data),
            b"" if method == "HEAD" else data,
        )
    # HY-131: a multipart body of an application with that form type is read in chunks into files of the request.
    exchange.body = RequestBody(
        environ.get("CONTENT_TYPE", ""),
        app.body_limit,
        "multipart/form-data" in app._form_types,
        app._value_limit,
        app._part_limit,
        app.file_limit,
    )
    if declared <= app.body_limit:
        # HY-100 and HY-59: a body over the limit is not read; its size is its Content-Length.
        read_body(environ["wsgi.input"].read, exchange.body, declared)
    exchange.request = Request(
        method,
        Request.target_path(target),
        _environ_headers(environ),
        Request.target_query(target),
        exchange.body.held(),
        cookies=cookies,
        https=https,
        body_size=max(exchange.body.size(), declared),
        read=exchange.body,
    )
    return answer_with(app, sessions, around, exchange)


def _cookie_header(environ: dict) -> Optional[bytes]:
    """Returns the `Cookie` header of the environ (HY-129) as the bytes that the server received: PEP 3333 gives it as
    text with one character per byte, so Latin-1 gives back those bytes. Returns None when the request has none."""
    value = environ.get("HTTP_COOKIE")
    return None if value is None else value.encode("latin-1")


def _request_target(environ: dict) -> str:
    """Returns the request target that the WSGI server received (HY-100): `RAW_URI` of gunicorn, or else
    `REQUEST_URI` of uWSGI and mod_wsgi. `PATH_INFO` is percent-decoded by the server and is never used.
    Fails when the environ has neither key."""
    for key in ("RAW_URI", "REQUEST_URI"):
        if key in environ:
            return environ[key]
    raise RuntimeError(
        "the WSGI environ has neither RAW_URI nor REQUEST_URI, so the request target is unknown (HY-100)"
    )


def _status(code: int) -> str:
    """The status line of a response code, as PEP 3333 writes it."""
    return f"{code} {HTTPStatus(code).phrase}"


def _environ_headers(environ: dict) -> dict[str, str]:
    """Returns the request headers of the WSGI environ in lower case, with `Content-Type` and
    `Content-Length` as headers, as PEP 3333 defines them."""
    headers: dict[str, str] = {}
    for name, value in environ.items():
        if name.startswith("HTTP_"):
            headers[name[5:].replace("_", "-").lower()] = value
        elif name in ("CONTENT_TYPE", "CONTENT_LENGTH"):
            headers[name.replace("_", "-").lower()] = value
    return headers
