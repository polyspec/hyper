"""A WSGI application callable of the server pipeline (HY-100): a WSGI server runs the callable and
the pipeline answers every request as `create_server` does (HY-97, HY-99) — the public files, the
body limit (HY-59), the session cookie of a new session first (HY-45), the hooks and the plain 500 of
an escaped error (HY-60). The library names no server; a deployment runs the callable with the server
that it chooses."""

from __future__ import annotations

import time
from dataclasses import dataclass
from http import HTTPStatus
from typing import Callable, Optional, Union

from .app import App
from .file_sessions import FileSessions
from .pipeline import CONTENT_TYPES, Exchange, answer_with, cookie_values, declared_length, escape, head_request, public_file, read_limited, validate
from .request import Request
from .response import Response


@dataclass
class FileResponse:
    """A file of the public directory that the callable serves before `around` (HY-100)."""

    headers: list[tuple[str, str]]
    data: bytes


def create_wsgi(app: App, sessions: FileSessions, files: Optional[str] = None,
                around: Optional[Callable[[Request, Callable[[Request], Response]], Response]] = None,
                written: Optional[Callable[[Request, Response, bool, float], None]] = None
                ) -> Callable[[dict, Callable], object]:
    """Returns a WSGI application callable (PEP 3333) that answers every request with the
    application, as `create_server` does (HY-100). `files`, `around` and `written` mean what they
    mean there (HY-97, HY-99): `written` reports that the write ended when the WSGI server consumed
    the whole body iterable, and that it failed when the server closed the iterable before its end,
    which PEP 3333 defines as premature termination; when the write failed, the disconnect hook runs
    with the request and the reply of the last call of `answer` (HY-67)."""
    validate(files, around, written)

    def application(environ: dict, start_response: Callable) -> object:
        started = time.perf_counter_ns()
        exchange = Exchange(written, started)
        try:
            result: Union[Response, FileResponse] = _answer(app, sessions, around, files, environ, exchange)
        except Exception as error:  # noqa: BLE001 - HY-60: an error that escapes the answer gets the plain 500
            result = escape(app, error)
        if isinstance(result, FileResponse):
            start_response(status(200), result.headers)
            return [result.data]
        headers = [(name, item) for name, value in result.headers.items()
                   for item in (value if isinstance(value, list) else [value])]
        empty = result.status in (204, 304)
        encoded = b'' if empty else result.body.encode('utf-8')
        if not empty:
            headers.append(('Content-Length', str(len(encoded))))
        start_response(status(result.status), headers)
        if empty:
            exchange.report(result, True)
            return [b'']
        return _body(app, exchange, result, encoded)

    return application


def _answer(app: App, sessions: FileSessions, around: Optional[Callable], files: Optional[str], environ: dict,
            exchange: Exchange) -> Union[Response, FileResponse]:
    """Answers the request of the environ: a file of the public directory, or the application through `around`.
    The request as received is kept in the exchange before the body is read (HY-60)."""
    method = environ['REQUEST_METHOD']
    target = _request_target(environ)
    declared = declared_length(environ.get('CONTENT_LENGTH'))
    exchange.request = head_request(method, target, _environ_headers(environ), environ.get('HTTP_COOKIE'), app.https,
                                    declared)
    served = None if files is None else public_file(files, method, target)
    if served is not None:
        # HY-100: the files of the public directory are served before `around`; no hook runs.
        data = served.read_bytes()
        return FileResponse([('Content-Type', CONTENT_TYPES.get(served.suffix, 'application/octet-stream')),
                             ('Content-Length', str(len(data)))], b'' if method == 'HEAD' else data)
    if declared > app.body_limit:
        # HY-100 and HY-59: a body over the limit is not read; its size is its Content-Length.
        body, size = b'', declared
    else:
        body, size = read_limited(environ['wsgi.input'].read, app.body_limit, declared)
    exchange.request = Request(method, Request.target_path(target), _environ_headers(environ),
                               Request.target_query(target), body,
                               cookies=cookie_values(environ.get('HTTP_COOKIE')), https=app.https, body_size=size)
    return answer_with(app, sessions, around, exchange)


def _body(app: App, exchange: Exchange, response: Response, encoded: bytes):
    """Returns the body iterable of a response. The write hook receives the end of the write when the server
    consumes the whole iterable; a server that closes the iterable early reports a failed write, and the
    disconnect hook runs when the request was answered by the application (HY-67, HY-99)."""
    try:
        yield encoded
    except GeneratorExit:
        # HY-100 and HY-67: the server closed the body iterable before its end, so the write of the response
        # failed; the write hook runs before the disconnect hook.
        exchange.report(response, False)
        exchange.disconnect(app)
        raise
    exchange.report(response, True)


def _request_target(environ: dict) -> str:
    """Returns the request target that the WSGI server received (HY-100): `RAW_URI` of gunicorn, or else
    `REQUEST_URI` of uWSGI and mod_wsgi. `PATH_INFO` is percent-decoded by the server and is never used.
    Fails when the environ has neither key."""
    for key in ('RAW_URI', 'REQUEST_URI'):
        if key in environ:
            return environ[key]
    raise RuntimeError('the WSGI environ has neither RAW_URI nor REQUEST_URI, so the request target is unknown (HY-100)')


def status(code: int) -> str:
    """The status line of a response code, as PEP 3333 writes it."""
    return f'{code} {HTTPStatus(code).phrase}'


def _environ_headers(environ: dict) -> dict[str, str]:
    """Returns the request headers of the WSGI environ in lower case, with `Content-Type` and
    `Content-Length` as headers, as PEP 3333 defines them."""
    headers: dict[str, str] = {}
    for name, value in environ.items():
        if name.startswith('HTTP_'):
            headers[name[5:].replace('_', '-').lower()] = value
        elif name in ('CONTENT_TYPE', 'CONTENT_LENGTH'):
            headers[name.replace('_', '-').lower()] = value
    return headers
