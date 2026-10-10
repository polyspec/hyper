# The ASGI application callable (HY-101): the pipeline of the Python server as a callable that an
# ASGI server runs, with the public files, the body limit (HY-59), the session cookie of a new
# session (HY-45), the request hook `around` (HY-97), the write hook `written` (HY-99), the
# disconnect hook on a failed send (HY-67) and the pipeline of a request in a worker thread.
import asyncio
import tempfile
import threading
import unittest
from pathlib import Path

from polyspec.hyper.asgi import create_asgi
from polyspec.hyper.file_sessions import FileSessions
from polyspec.hyper.reply import Reply
from polyspec.hyper.request import Request
from polyspec.hyper.response import Response


class Application:
    """An application that answers with what the request gave, and records it and its replies."""

    https = False
    body_limit = 16

    def __init__(self):
        self.requests: list[Request] = []
        self.replies: list[object] = []
        self.disconnected_calls: list[tuple[Request, object]] = []
        self.threads: list[int] = []
        self.opens_session = False

    def respond(self, request: Request, session, started: int):
        self.requests.append(request)
        self.threads.append(threading.get_ident())
        if self.opens_session:
            session.set('count', 1)
        reply = Reply()
        self.replies.append(reply)
        return Response(200, {'Content-Type': ['text/plain; charset=utf-8'],
                              'X-Answer': 'given'}, f'{request.method} {request.path()}'), reply

    def disconnected(self, request: Request, started: int, reply) -> None:
        self.disconnected_calls.append((request, reply))


class Sends:
    """The `send` of an ASGI server, which records every event; `broken` makes a send fail as a
    connection that the client closed does."""

    def __init__(self, broken: bool = False):
        self.events: list[dict] = []
        self.broken = broken

    async def __call__(self, event: dict) -> None:
        if self.broken:
            raise OSError('the client closed the connection')
        self.events.append(event)


class Receives:
    """The `receive` of an ASGI server, which yields the request body events of `data`."""

    def __init__(self, data: bytes):
        self.data = data

    async def __call__(self) -> dict:
        if self.data is None:
            return {'type': 'http.disconnect'}
        part, self.data = self.data[:65536], self.data[65536:]
        return {'type': 'http.request', 'body': part, 'more_body': bool(self.data)}


def scope(**changes) -> dict:
    values = {'type': 'http', 'method': 'GET', 'path': '/', 'raw_path': b'/', 'query_string': b'',
              'headers': []}
    values.update(changes)
    return values


def run(application, values: dict, sends: Sends, receives: Receives) -> None:
    asyncio.run(application(values, receives, sends))


class AsgiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.sessions = FileSessions(str(Path(self.directory.name).resolve()))
        self.app = Application()

    def test_the_request_reaches_the_application(self) -> None:
        written = []
        application = create_asgi(self.app, self.sessions,
                                  written=lambda request, response, ended, elapsed: written.append(
                                      (request, ended)))
        sends = Sends()
        run(application, scope(method='POST', path='/news', raw_path=b'/news', query_string=b'page=2',
                               headers=[(b'x-name', b'one'), (b'cookie', b'a=1; hy-session=s')]),
            sends, Receives(b'hello'))
        request = self.app.requests[0]
        self.assertEqual('POST', request.method)
        self.assertEqual('/news', request.path())
        self.assertEqual('page=2', request.raw_query())
        self.assertEqual('one', request.header('x-name'))
        self.assertEqual('s', request.cookie('hy-session'))
        self.assertEqual(5, request.body_size())
        self.assertEqual({'type': 'http.response.start', 'status': 200,
                          'headers': [(b'content-type', b'text/plain; charset=utf-8'),
                                      (b'x-answer', b'given'), (b'content-length', b'10')]}, sends.events[0])
        self.assertEqual({'type': 'http.response.body', 'body': b'POST /news'}, sends.events[1])
        self.assertEqual([(request, True)], written)

    def test_the_pipeline_runs_in_a_worker_thread(self) -> None:
        application = create_asgi(self.app, self.sessions)
        sends = Sends()
        loop_thread = []

        async def call() -> None:
            loop_thread.append(threading.get_ident())
            await application(scope(), Receives(b''), sends)

        asyncio.run(call())
        self.assertNotEqual(loop_thread[0], self.app.threads[0])

    def test_a_new_session_sets_its_cookie_first(self) -> None:
        self.app.opens_session = True
        application = create_asgi(self.app, self.sessions)
        sends = Sends()
        run(application, scope(), sends, Receives(b''))
        values = [value for name, value in sends.events[0]['headers'] if name == b'set-cookie']
        self.assertEqual(1, len(values))
        self.assertTrue(values[0].startswith(b'hy-session='))

    def test_a_body_over_the_limit_reads_no_more(self) -> None:
        application = create_asgi(self.app, self.sessions)
        sends = Sends()
        run(application, scope(method='POST', headers=[(b'content-length', b'25')]),
            sends, Receives(b'0123456789abcdef012345678'))
        self.assertEqual(25, self.app.requests[0].body_size())

    def test_a_public_file_is_served_before_around(self) -> None:
        files = Path(self.directory.name) / 'public'
        files.mkdir()
        (files / 'a.css').write_text('body{}', encoding='utf-8')
        around_calls = []
        application = create_asgi(self.app, self.sessions, files=str(files),
                                  around=lambda request, answer: around_calls.append(request))
        sends = Sends()
        run(application, scope(path='/a.css', raw_path=b'/a.css'), sends, Receives(b''))
        self.assertEqual(200, sends.events[0]['status'])
        self.assertEqual([(b'content-type', b'text/css; charset=utf-8'), (b'content-length', b'6')],
                         sends.events[0]['headers'])
        self.assertEqual(b'body{}', sends.events[1]['body'])
        self.assertEqual([], self.app.requests)
        self.assertEqual([], around_calls)

    def test_a_failed_send_reports_and_disconnects(self) -> None:
        written = []
        application = create_asgi(self.app, self.sessions,
                                  written=lambda request, response, ended, elapsed: written.append(
                                      (request, ended)))
        with self.assertRaises(OSError):
            run(application, scope(), Sends(broken=True), Receives(b''))
        self.assertEqual([(self.app.requests[0], False)], written)
        self.assertEqual([(self.app.requests[0], self.app.replies[0])], self.app.disconnected_calls)

    def test_around_answers_without_the_application(self) -> None:
        written = []
        captured = []
        application = create_asgi(self.app, self.sessions,
                                  around=lambda request, answer: captured.append(request)
                                  or Response(204, {}, ''),
                                  written=lambda request, response, ended, elapsed: written.append(
                                      (request, ended)))
        sends = Sends()
        run(application, scope(), sends, Receives(b''))
        self.assertEqual(204, sends.events[0]['status'])
        self.assertEqual([], sends.events[0]['headers'])
        self.assertEqual(b'', sends.events[1]['body'])
        self.assertEqual([], self.app.requests)
        self.assertEqual([(captured[0], True)], written)

    def test_the_raw_path_is_used_and_not_the_decoded_path(self) -> None:
        # HY-101: `path` is percent-decoded by the server; the path is `raw_path` as sent.
        cases = [(b'/notes/a%20b', '/notes/a b', '/notes/a%20b', ''),
                 (b'/notes/a%2Fb', '/notes/a/b', '/notes/a%2Fb', ''),
                 (b'/caf%C3%A9', '/caf\xc3\xa9', '/caf%C3%A9', 'q=%E2%82%AC')]
        for raw, decoded, path, query in cases:
            with self.subTest(raw=raw):
                run(create_asgi(self.app, self.sessions),
                    scope(path=decoded, raw_path=raw, query_string=query.encode('latin-1')),
                    Sends(), Receives(b''))
                request = self.app.requests[-1]
                self.assertEqual((path, query), (request.path(), request.raw_query()))

    def test_a_missing_raw_path_fails_naming_it(self) -> None:
        # HY-101: the path is never built from the decoded `path`; the request fails before any send.
        without = {key: value for key, value in scope(path='/notes/a b').items() if key != 'raw_path'}
        for values in (without, scope(path='/notes/a b', raw_path=None)):
            with self.subTest(values=values):
                sends = Sends()
                with self.assertRaises(RuntimeError) as failure:
                    run(create_asgi(self.app, self.sessions), values, sends, Receives(b''))
                self.assertIn('raw_path', str(failure.exception))
                self.assertEqual([], sends.events)
                self.assertEqual([], self.app.requests)
