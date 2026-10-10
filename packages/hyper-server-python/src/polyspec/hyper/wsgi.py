"""A WSGI application callable of the server pipeline (HY-100): a WSGI server runs the callable and
the pipeline answers every request as `create_server` does (HY-97, HY-99) — the public files, the
body limit (HY-59), the session cookie of a new session first (HY-45) and the hooks. The library
names no server; a deployment runs the callable with the server that it chooses."""

from __future__ import annotations

import time
from http import HTTPStatus
from typing import Callable, Optional

from .app import App
from .file_sessions import FileSessions
from .pipeline import CONTENT_TYPES, answer_with, cookie_values, public_file, read_limited, reported, validate
from .reply import Reply
from .request import Request
from .response import Response


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
        method = environ['REQUEST_METHOD']
        path = environ.get('PATH_INFO', '/')
        served = None if files is None else public_file(files, method, path)
        if served is not None:
            # HY-100: the files of the public directory are served before `around`; no hook runs.
            data = served.read_bytes()
            start_response(status(200), [('Content-Type', CONTENT_TYPES.get(served.suffix, 'application/octet-stream')),
                                         ('Content-Length', str(len(data)))])
            return [b''] if method == 'HEAD' else [data]
        declared = environ.get('CONTENT_LENGTH') or ''
        length = int(declared) if declared.isdigit() else 0
        body, size = read_limited(environ['wsgi.input'].read, app.body_limit, length)
        request = Request(method, path, _environ_headers(environ), environ.get('QUERY_STRING', ''), body,
                          cookies=cookie_values(environ.get('HTTP_COOKIE')), https=app.https, body_size=size)
        response, answered = answer_with(app, sessions, around, request, started)
        headers = [(name, item) for name, value in response.headers.items()
                   for item in (value if isinstance(value, list) else [value])]
        empty = response.status in (204, 304)
        encoded = b'' if empty else response.body.encode('utf-8')
        if not empty:
            headers.append(('Content-Length', str(len(encoded))))
        start_response(status(response.status), headers)
        if empty:
            reported(written, request, response, True, started)
            return [b'']

        def body_iterable():
            try:
                yield encoded
            except GeneratorExit:
                # HY-100 and HY-67: the server closed the body iterable before its end, so the write
                # of the response failed; the write hook runs before the disconnect hook.
                reported(written, request, response, False, started)
                if answered:
                    app.disconnected(answered[0][0], started, answered[0][1])
                raise
            reported(written, request, response, True, started)

        return body_iterable()

    return application


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
