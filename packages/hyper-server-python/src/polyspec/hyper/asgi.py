"""An ASGI application callable of the server pipeline (HY-101): an ASGI server runs the callable
and the pipeline answers every request of the scope type `http` as `create_server` does (HY-97,
HY-99) — the public files, the body limit (HY-59), the session cookie of a new session first
(HY-45), the hooks and the plain 500 of an escaped error (HY-60) — and runs the pipeline of a request
in a worker thread. The library names no server; a deployment runs the callable with the server that
it chooses."""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Callable, Optional, Union

from .app import App
from .file_sessions import FileSessions
from .pipeline import CONTENT_TYPES, Exchange, answer_with, cookie_values, declared_length, escape, head_request, public_file, validate
from .request import Request
from .response import Response


@dataclass
class FileResponse:
    """A file of the public directory that the callable sends before `around` (HY-101)."""

    headers: list[tuple[bytes, bytes]]
    data: bytes


def create_asgi(app: App, sessions: FileSessions, files: Optional[str] = None,
                around: Optional[Callable[[Request, Callable[[Request], Response]], Response]] = None,
                written: Optional[Callable[[Request, Response, bool, float], None]] = None
                ) -> Callable:
    """Returns an ASGI 3 application callable that answers every request with the application, as
    `create_server` does (HY-101). `files`, `around` and `written` mean what they mean there (HY-97,
    HY-99): the callable sends one `http.response.start` and one `http.response.body` with the
    complete body, `written` reports that the write ended when both sends return, and that it failed
    when a send raises, which an ASGI server does for a connection that the client closed; when the
    write failed, the callable calls the disconnect hook with the request and the reply of the last
    call of `answer` (HY-67) and lets the error propagate to the server."""
    validate(files, around, written)

    async def application(scope: dict, receive: Callable, send: Callable) -> None:
        if scope['type'] != 'http':
            raise ValueError(f'the callable answers the scope type http, not {scope["type"]}')
        started = time.perf_counter_ns()
        exchange = Exchange(written, started)
        try:
            result: Union[Response, FileResponse] = await _answer(app, sessions, around, files, scope, receive, exchange)
        except Exception as error:  # noqa: BLE001 - HY-60: an error that escapes the answer gets the plain 500
            result = escape(app, error)
        if isinstance(result, FileResponse):
            await send({'type': 'http.response.start', 'status': 200, 'headers': result.headers})
            await send({'type': 'http.response.body', 'body': result.data})
            return
        headers = [(name.lower().encode('ascii'), item.encode('utf-8')) for name, value in result.headers.items()
                   for item in (value if isinstance(value, list) else [value])]
        empty = result.status in (204, 304)
        encoded = b'' if empty else result.body.encode('utf-8')
        if not empty:
            headers.append((b'content-length', str(len(encoded)).encode('ascii')))
        try:
            await send({'type': 'http.response.start', 'status': result.status, 'headers': headers})
            await send({'type': 'http.response.body', 'body': encoded})
        except Exception:
            # HY-101 and HY-67: a send raised, which an ASGI server does for a connection that the client
            # closed; the write hook runs before the disconnect hook, and the error propagates.
            exchange.report(result, False)
            exchange.disconnect(app)
            raise
        exchange.report(result, True)

    return application


async def _answer(app: App, sessions: FileSessions, around: Optional[Callable], files: Optional[str], scope: dict,
                  receive: Callable, exchange: Exchange) -> Union[Response, FileResponse]:
    """Answers the request of the scope: a file of the public directory, or the application through `around` in a
    worker thread (HY-101). The request as received is kept in the exchange before the body is read (HY-60)."""
    method = scope['method']
    target = _raw_path(scope)
    declared = declared_length(_header(scope, b'content-length'))
    exchange.request = head_request(method, target, _scope_headers(scope), _header(scope, b'cookie'), app.https,
                                    declared)
    served = None if files is None else public_file(files, method, target)
    if served is not None:
        # HY-101: the files of the public directory are served before `around`; no hook runs.
        data = served.read_bytes()
        return FileResponse([(b'content-type', CONTENT_TYPES.get(served.suffix, 'application/octet-stream').encode('ascii')),
                             (b'content-length', str(len(data)).encode('ascii'))], b'' if method == 'HEAD' else data)
    body, size = await _read_body(receive, app.body_limit)
    exchange.request = Request(method, Request.target_path(target), _scope_headers(scope),
                               scope.get('query_string', b'').decode('latin-1'), body,
                               cookies=cookie_values(_header(scope, b'cookie')), https=app.https, body_size=size)
    # HY-101: the pipeline of a request runs in a worker thread, so the event loop answers other requests while a
    # request responds.
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, answer_with, app, sessions, around, exchange)


async def _read_body(receive: Callable, limit: int) -> tuple[bytes, int]:
    """Reads the request body from the receive events up to the limit and no more, and its size. A
    body larger than the limit gives no bytes and the size read so far; the rest of it is read and
    discarded, so that the response can be sent (HY-59)."""
    size = 0
    body = bytearray()
    while True:
        event = await receive()
        if event['type'] != 'http.request':
            break
        part = event.get('body', b'')
        size += len(part)
        if size <= limit:
            body.extend(part)
        if not event.get('more_body', False):
            break
    return bytes(body), size


def _raw_path(scope: dict) -> str:
    """Returns the raw request path of the scope, the bytes of `raw_path` decoded as latin-1 (HY-101). The path
    is never built from `path`, which the server percent-decodes; a scope without `raw_path` has no target, and
    the request is answered with the plain 500 (HY-60)."""
    raw = scope.get('raw_path')
    if raw is None:
        raise RuntimeError("the ASGI scope has no raw_path, so the request path is unknown (HY-101)")
    return raw.decode('latin-1')


def _header(scope: dict, name: bytes) -> Optional[str]:
    """Returns one header of the scope as text, with the values of its repeats joined as HTTP reads
    them, or None."""
    values = [value for key, value in scope.get('headers', []) if key == name]
    return ', '.join(value.decode('latin-1') for value in values) if values else None


def _scope_headers(scope: dict) -> dict[str, str]:
    """Returns the request headers of the scope in lower case; a repeated header joins its values,
    as HTTP reads it."""
    joined: dict[str, list[str]] = {}
    for key, value in scope.get('headers', []):
        joined.setdefault(key.decode('latin-1').lower(), []).append(value.decode('latin-1'))
    return {name: ', '.join(values) for name, values in joined.items()}
