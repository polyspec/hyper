"""An ASGI application callable of the server pipeline (HY-101): an ASGI server runs the callable
and the pipeline answers every request of the scope type `http` as `create_server` does (HY-97,
HY-99) — the public files, the body limit (HY-59), the session cookie of a new session first
(HY-45) and the hooks — and runs the pipeline of a request in a worker thread. The library names
no server; a deployment runs the callable with the server that it chooses."""

from __future__ import annotations

import asyncio
import time
from typing import Callable, Optional

from .app import App
from .file_sessions import FileSessions
from .pipeline import CONTENT_TYPES, answer_with, cookie_values, public_file, reported, validate
from .request import Request
from .response import Response


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
        method = scope['method']
        path = scope['path']
        served = None if files is None else public_file(files, method, path)
        if served is not None:
            # HY-101: the files of the public directory are served before `around`; no hook runs.
            data = served.read_bytes()
            await send({'type': 'http.response.start', 'status': 200,
                        'headers': [(b'content-type', CONTENT_TYPES.get(served.suffix,
                                                                       'application/octet-stream').encode('ascii')),
                                    (b'content-length', str(len(data)).encode('ascii'))]})
            await send({'type': 'http.response.body', 'body': b'' if method == 'HEAD' else data})
            return
        body, size = await _read_body(receive, app.body_limit)
        request = Request(method, path, _scope_headers(scope), scope.get('query_string', b'').decode('latin-1'),
                          body, cookies=cookie_values(_header(scope, b'cookie')), https=app.https, body_size=size)
        # HY-101: the pipeline of a request runs in a worker thread, so the event loop answers other
        # requests while a request responds.
        loop = asyncio.get_running_loop()
        response, answered = await loop.run_in_executor(None, answer_with, app, sessions, around, request, started)
        headers = [(name.lower().encode('ascii'), item.encode('utf-8')) for name, value in response.headers.items()
                   for item in (value if isinstance(value, list) else [value])]
        empty = response.status in (204, 304)
        encoded = b'' if empty else response.body.encode('utf-8')
        if not empty:
            headers.append((b'content-length', str(len(encoded)).encode('ascii')))
        try:
            await send({'type': 'http.response.start', 'status': response.status, 'headers': headers})
            await send({'type': 'http.response.body', 'body': encoded})
        except Exception:
            # HY-101 and HY-67: a send raised, which an ASGI server does for a connection that the
            # client closed; the write hook runs before the disconnect hook, and the error propagates.
            reported(written, request, response, False, started)
            if answered:
                app.disconnected(answered[0][0], started, answered[0][1])
            raise
        reported(written, request, response, True, started)

    return application


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
