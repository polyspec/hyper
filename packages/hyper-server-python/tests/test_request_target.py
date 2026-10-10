# The request target of the three transports (HY-42, HY-56, HY-97, HY-100, HY-101): `create_server`, the WSGI
# callable and the ASGI callable give the same request and the same response for one target, and the
# percent sequences of the target reach the application as the client sent them.
import asyncio
import http.client
import io
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.parse import unquote

from polyspec.hyper.asgi import create_asgi
from polyspec.hyper.file_sessions import FileSessions
from polyspec.hyper.reply import Reply
from polyspec.hyper.response import Response
from polyspec.hyper.server import create_server
from polyspec.hyper.wsgi import create_wsgi

TARGETS = [
    '/notes/a%20b',
    '/notes/a%2Fb',
    '/notes/a/b',
    '/caf%C3%A9?q=%E2%82%AC&x=1',
    '/items/1?a=1?b=2',
]


class Application:
    """An application that answers with the path and the raw query that the request gave, and records them."""

    https = False
    body_limit = 1024

    def __init__(self):
        self.seen: list[tuple[str, str]] = []

    def respond(self, request, session, started):
        self.seen.append((request.path(), request.raw_query()))
        return Response(200, {'Content-Type': ['text/plain; charset=utf-8']},
                        f'{request.path()} {request.raw_query()}'), Reply()

    def disconnected(self, request, started, reply) -> None:
        pass


def split(target: str) -> tuple[str, str]:
    """Returns the path and the raw query of a target as the test states them."""
    path, _, query = target.partition('?')
    return path, query


def via_create_server(app, sessions, target: str) -> tuple[int, bytes]:
    server = create_server(app, sessions, host='127.0.0.1', port=0)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        connection = http.client.HTTPConnection('127.0.0.1', server.server_address[1], timeout=10)
        connection.request('GET', target)
        reply = connection.getresponse()
        body = reply.read()
        connection.close()
        return reply.status, body
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=10)


def via_wsgi(app, sessions, target: str) -> tuple[int, bytes]:
    path, query = split(target)
    values = {'REQUEST_METHOD': 'GET', 'RAW_URI': target, 'PATH_INFO': unquote(path), 'QUERY_STRING': query,
              'wsgi.input': io.BytesIO(b'')}
    head: list = []
    body = b''.join(create_wsgi(app, sessions)(values, lambda status, headers, exc_info=None: head.append(status)))
    return int(head[0].split(' ', 1)[0]), body


def via_asgi(app, sessions, target: str) -> tuple[int, bytes]:
    path, query = split(target)
    values = {'type': 'http', 'method': 'GET', 'path': unquote(path), 'raw_path': path.encode('latin-1'),
              'query_string': query.encode('latin-1'), 'headers': []}
    events: list[dict] = []

    async def receive() -> dict:
        return {'type': 'http.request', 'body': b'', 'more_body': False}

    async def send(event: dict) -> None:
        events.append(event)

    asyncio.run(create_asgi(app, sessions)(values, receive, send))
    return events[0]['status'], events[1]['body']


class RequestTargetTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.sessions = FileSessions(str(Path(self.directory.name).resolve()))

    def test_the_three_transports_give_equal_requests_and_responses(self) -> None:
        transports = [('create_server', via_create_server), ('wsgi', via_wsgi), ('asgi', via_asgi)]
        for target in TARGETS:
            path, query = split(target)
            with self.subTest(target=target):
                outcomes = {}
                for name, transport in transports:
                    app = Application()
                    outcomes[name] = (transport(app, self.sessions, target), app.seen)
                self.assertEqual([(path, query)], outcomes['create_server'][1])
                self.assertEqual((200, f'{path} {query}'.encode('utf-8')), outcomes['create_server'][0])
                self.assertEqual(outcomes['create_server'], outcomes['wsgi'])
                self.assertEqual(outcomes['create_server'], outcomes['asgi'])
