# The `http.server` server of the package with a real socket on 127.0.0.1 and a port that the system assigns: the
# disconnect hook of a client that closed the connection (HY-60, HY-67), the request hook `around` (HY-97) and the
# write hook `written` (HY-99).
import json
import shutil
import socket
import struct
import tempfile
import threading
import unittest
from pathlib import Path
from typing import Callable, Optional

from polyspec.hyper.app import App
from polyspec.hyper.file_sessions import FileSessions
from polyspec.hyper.reply import Reply
from polyspec.hyper.request import Request
from polyspec.hyper.response import Response
from polyspec.hyper.server import create_server

TESTS = Path(__file__).resolve().parents[2]
MANIFEST = TESTS.parent / 'hyper-server-php' / 'tests' / 'fixtures' / 'app.json'
# The JSON response of the route `home` carries a string of this many bytes. The body is larger than the buffers of
# a loopback socket, so a write of it to a closed connection fails also when the reset of the client arrives late.
LARGE = 6 * 1024 * 1024
# The read paths of the JSON responses of these tests; a JSON response renders no template (HY-73).
READS = {'routes': {'home': {'shared': True, 'regions': {'side': True, 'content': True}}}}


def open_app(load: Callable, **options) -> App:
    """Opens a copy of the fixture manifest with a server program of its own: the read paths and an empty template
    directory, because a JSON response renders no template."""
    program = Path(tempfile.mkdtemp(prefix='hyper-server-program-'))
    try:
        manifest = program / 'app.json'
        shutil.copyfile(MANIFEST, manifest)
        (program / 'templates').mkdir()
        (program / 'reads.json').write_text(json.dumps(READS), encoding='utf-8')
        handlers = {'regions': {'side': lambda: {}},
                    'routes': {'home': {'load': load}, 'add': {'post': lambda: None}}}
        return App.open(manifest=str(manifest), program=str(program), handlers=handlers, timezone='+09:00',
                        response_limit=2 * LARGE, **options)
    finally:
        shutil.rmtree(program)


class Served:
    """Serves an application in a thread; leaving the block stops the server and awaits every request thread, so a
    test reads the calls of the hooks after every request ended (HY-87)."""

    def __init__(self, app: App, **options):
        self._sessions = tempfile.TemporaryDirectory(prefix='hyper-server-sessions-')
        try:
            self.server = create_server(app, FileSessions(self._sessions.name), **options)
        except Exception:
            self._sessions.cleanup()
            raise
        # A request thread that is not a daemon thread is awaited by `server_close`.
        self.server.daemon_threads = False
        self._thread = threading.Thread(target=self.server.serve_forever)

    def __enter__(self) -> 'Served':
        self._thread.start()
        return self

    def __exit__(self, *exc: object) -> None:
        self.server.shutdown()
        self._thread.join()
        self.server.server_close()
        self._sessions.cleanup()

    def sessions(self) -> list[str]:
        """Returns the names of the session files."""
        return sorted(path.name for path in Path(self._sessions.name).iterdir())

    def connect(self, target: str = '/', headers: Optional[dict] = None) -> socket.socket:
        """Opens a connection and sends a JSON GET request of the target."""
        client = socket.create_connection(self.server.server_address[:2])
        lines = [f'GET {target} HTTP/1.1', 'Host: 127.0.0.1', 'Accept: application/json', 'Connection: close',
                 *(f'{name}: {value}' for name, value in (headers or {}).items())]
        client.sendall(('\r\n'.join(lines) + '\r\n\r\n').encode('latin-1'))
        return client


def read_all(client: socket.socket) -> bytes:
    """Reads the response until the server closes the connection."""
    chunks = []
    while chunk := client.recv(65536):
        chunks.append(chunk)
    client.close()
    return b''.join(chunks)


def parse(response: bytes) -> tuple[int, dict[str, list[str]], bytes]:
    """Returns the status, the headers by lower-case name and the body of a response."""
    head, _, body = response.partition(b'\r\n\r\n')
    lines = head.decode('latin-1').split('\r\n')
    headers: dict[str, list[str]] = {}
    for line in lines[1:]:
        name, _, value = line.partition(':')
        headers.setdefault(name.lower(), []).append(value.strip())
    return int(lines[0].split(' ')[1]), headers, body


def reset(client: socket.socket) -> None:
    """Closes a connection with a reset, so the next write of the server to it fails."""
    client.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack('ii', 1, 0))
    client.close()


def loader(replies: list) -> Callable:
    def load(reply: Reply) -> dict:
        replies.append(reply)
        reply.note('loaded', True)
        return {'name': 'x' * LARGE}

    return load


class DisconnectTest(unittest.TestCase):
    def test_a_client_that_closed_the_connection_is_reported_once_after_the_response_hook(self) -> None:
        # HY-67: the server writes the response after the response hook; the write fails because the client closed
        # the connection, and the disconnect hook receives the request, the elapsed time and the reply.
        events: list = []
        replies: list = []
        rendered = threading.Event()
        closed = threading.Event()

        def on_response(request, response, elapsed, reply, failure) -> None:
            events.append(('response', request.path(), response.status, reply))
            rendered.set()
            closed.wait()

        def on_disconnect(request, elapsed, reply) -> None:
            events.append(('disconnect', request.path(), request.header('Accept'), elapsed >= 0, reply))

        app = open_app(loader(replies), on_response=on_response, on_disconnect=on_disconnect)
        with Served(app) as served:
            client = served.connect()
            try:
                rendered.wait()
                reset(client)
            finally:
                closed.set()
        self.assertEqual(1, len(replies))
        self.assertEqual([('response', '/', 200, replies[0]),
                          ('disconnect', '/', 'application/json', True, replies[0])], events)
        self.assertEqual({'loaded': True}, replies[0].notes())

    def test_a_client_that_reads_the_whole_response_is_not_reported(self) -> None:
        # HY-67: every write succeeds, so the server detects no close.
        events: list = []
        app = open_app(loader([]), on_response=lambda *args: events.append('response'),
                       on_disconnect=lambda *args: events.append('disconnect'))
        with Served(app) as served:
            response = read_all(served.connect())
        self.assertTrue(response.startswith(b'HTTP/1.0 200 '))
        self.assertGreater(len(response), LARGE)
        self.assertEqual(['response'], events)

    def test_a_disconnect_hook_that_is_not_callable_fails_when_the_application_opens(self) -> None:
        with self.assertRaisesRegex(ValueError, 'on_disconnect'):
            open_app(loader([]), on_disconnect='log')


class AroundTest(unittest.TestCase):
    def test_around_that_answers_alone_runs_no_part_of_the_application(self) -> None:
        # HY-97: a response of `around` without `answer` opens no session and runs no loader and no hook.
        events: list = []

        def around(request: Request, answer: Callable) -> Response:
            if request.header('X-Web-Server') != 'front':
                return Response.text(400, 'Bad Request')
            return answer(request)

        app = open_app(lambda: events.append('load') or {'name': 'n'},
                       on_response=lambda *args: events.append('response'),
                       on_disconnect=lambda *args: events.append('disconnect'))
        with Served(app, around=around) as served:
            status, headers, body = parse(read_all(served.connect()))
            self.assertEqual([], served.sessions())
            answered, _, _ = parse(read_all(served.connect(headers={'X-Web-Server': 'front'})))
        self.assertEqual((400, b'Bad Request'), (status, body))
        self.assertNotIn('set-cookie', headers)
        self.assertEqual(200, answered)
        self.assertEqual(['load', 'response'], events)

    def test_around_changes_the_request_and_the_response(self) -> None:
        # HY-97: the application reads the header that `around` set, and the client receives the header that
        # `around` added to the response with the cookie of the new session (HY-45).
        seen: list = []

        def around(request: Request, answer: Callable) -> Response:
            response = answer(request.with_header('X-Request-Id', 'r1'))
            return response.with_header('X-Request-Id', 'r1')

        def load(request: Request) -> dict:
            seen.append(request.header('x-request-id'))
            return {'name': 'n'}

        app = open_app(load, on_response=lambda request, *args: seen.append(request.header('X-Request-Id')))
        with Served(app, around=around) as served:
            status, headers, body = parse(read_all(served.connect()))
            sessions = served.sessions()
        self.assertEqual(200, status)
        self.assertEqual(['r1'], headers['x-request-id'])
        self.assertEqual(1, len(sessions))
        self.assertTrue(headers['set-cookie'][0].startswith(f'hy-session={sessions[0]}; '))
        self.assertEqual('n', json.loads(body)['regions']['content']['name'])
        self.assertEqual(['r1', 'r1'], seen)

    def test_around_runs_the_answer_in_a_context_of_its_own(self) -> None:
        # HY-97: the loaders of the request run inside the call of `answer`, so they read the context of `around`.
        context = threading.local()
        seen: list = []

        def around(request: Request, answer: Callable) -> Response:
            context.request = request.header('X-Request-Id')
            try:
                return answer(request)
            finally:
                del context.request

        def load() -> dict:
            seen.append(getattr(context, 'request', None))
            return {'name': 'n'}

        with Served(open_app(load), around=around) as served:
            read_all(served.connect(headers={'X-Request-Id': 'a'}))
            read_all(served.connect(headers={'X-Request-Id': 'b'}))
        self.assertEqual(['a', 'b'], seen)

    def test_the_disconnect_hook_receives_the_request_of_the_answer(self) -> None:
        # HY-67, HY-97: the hook receives the request that `around` gave to `answer`.
        events: list = []
        replies: list = []
        rendered = threading.Event()
        closed = threading.Event()

        def around(request: Request, answer: Callable) -> Response:
            response = answer(request.with_header('X-Request-Id', 'r1'))
            rendered.set()
            closed.wait()
            return response

        app = open_app(loader(replies), on_disconnect=lambda request, elapsed, reply: events.append(
            (request.header('X-Request-Id'), reply)))
        with Served(app, around=around) as served:
            client = served.connect()
            try:
                rendered.wait()
                reset(client)
            finally:
                closed.set()
        self.assertEqual([('r1', replies[0])], events)

    def test_a_response_of_around_alone_to_a_closed_connection_calls_no_hook(self) -> None:
        # HY-97: without a call of `answer`, no hook of the application runs, also when the write fails (HY-67).
        events: list = []
        rendered = threading.Event()
        closed = threading.Event()

        def around(request: Request, answer: Callable) -> Response:
            rendered.set()
            closed.wait()
            return Response.text(200, 'x' * LARGE)

        app = open_app(loader([]), on_response=lambda *args: events.append('response'),
                       on_disconnect=lambda *args: events.append('disconnect'))
        with Served(app, around=around) as served:
            client = served.connect()
            try:
                rendered.wait()
                reset(client)
            finally:
                closed.set()
            self.assertEqual([], served.sessions())
        self.assertEqual([], events)

    def test_around_that_is_not_callable_fails_when_the_server_is_created(self) -> None:
        with tempfile.TemporaryDirectory() as sessions:
            with self.assertRaisesRegex(ValueError, 'around'):
                create_server(open_app(loader([])), FileSessions(sessions), around='wrap')


class WrittenTest(unittest.TestCase):
    def test_the_write_hook_receives_the_request_and_the_response(self) -> None:
        # HY-99: the server calls the hook after it wrote the response, with the request, the response and True.
        events: list = []

        def written(request: Request, response: Response, sent: bool) -> None:
            events.append((request.path(), response.status, sent))

        with Served(open_app(loader([])), written=written) as served:
            status, _, _ = parse(read_all(served.connect()))
        self.assertEqual(200, status)
        self.assertEqual([('/', 200, True)], events)

    def test_the_write_hook_runs_before_the_disconnect_hook_when_the_write_fails(self) -> None:
        # HY-99, HY-67: a write that fails because the client closed the connection reports False before the
        # disconnect hook runs.
        events: list = []
        rendered = threading.Event()
        closed = threading.Event()

        def on_response(request, response, elapsed, reply, failure) -> None:
            rendered.set()
            closed.wait()

        app = open_app(loader([]), on_response=on_response,
                       on_disconnect=lambda request, elapsed, reply: events.append(('disconnect', request.path())))
        with Served(app, written=lambda request, response, sent: events.append(
                ('written', request.path(), response.status, sent))) as served:
            client = served.connect()
            try:
                rendered.wait()
                reset(client)
            finally:
                closed.set()
        self.assertEqual([('written', '/', 200, False), ('disconnect', '/')], events)

    def test_the_write_hook_runs_for_a_response_of_around_alone(self) -> None:
        # HY-99: the hook is called also when `around` returned its own response without calling `answer` (HY-97).
        events: list = []

        def around(request: Request, answer: Callable) -> Response:
            return Response.text(400, 'Bad Request')

        with Served(open_app(loader([])), around=around,
                    written=lambda request, response, sent: events.append((response.status, response.body, sent))) \
                as served:
            status, _, body = parse(read_all(served.connect()))
        self.assertEqual((400, b'Bad Request'), (status, body))
        self.assertEqual([(400, 'Bad Request', True)], events)

    def test_the_write_hook_of_a_response_of_around_alone_to_a_closed_connection_calls_no_disconnect(self) -> None:
        # HY-99, HY-67: the failed write of a response of `around` alone reports False, and without a call of
        # `answer` the disconnect hook does not run (HY-97).
        events: list = []
        rendered = threading.Event()
        closed = threading.Event()

        def around(request: Request, answer: Callable) -> Response:
            rendered.set()
            closed.wait()
            return Response.text(200, 'x' * LARGE)

        app = open_app(loader([]), on_disconnect=lambda *args: events.append('disconnect'))
        with Served(app, around=around,
                    written=lambda request, response, sent: events.append(('written', sent))) as served:
            client = served.connect()
            try:
                rendered.wait()
                reset(client)
            finally:
                closed.set()
            self.assertEqual([], served.sessions())
        self.assertEqual([('written', False)], events)

    def test_a_write_hook_that_is_not_callable_fails_when_the_server_is_created(self) -> None:
        with tempfile.TemporaryDirectory() as sessions:
            with self.assertRaisesRegex(ValueError, 'written'):
                create_server(open_app(loader([])), FileSessions(sessions), written='log')


if __name__ == '__main__':
    unittest.main()
