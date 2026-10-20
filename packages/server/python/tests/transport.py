"""What the tests of the ASGI callable (HY-100) and of the WSGI callable (HY-100) share: the application that they run,
the set-up of a test, the hooks that record what the write hook reports and the checks of a request that reached the
application."""

import http.client
import tempfile
import threading
import unittest
from pathlib import Path

from polyspec.hyper.file_sessions import FileSessions
from polyspec.hyper.reply import Reply
from polyspec.hyper.request import Request
from polyspec.hyper.response import Response


class Application:
    """An application that answers with what the request gave, and records it and its replies."""

    https = False
    frame_ancestors = "'self'"
    body_limit = 16

    def __init__(self, opens_session: bool = False):
        self.requests: list[Request] = []
        self.replies: list[object] = []
        self.disconnected_calls: list[tuple[Request, object]] = []
        self.threads: list[int] = []
        self.opens_session = opens_session

    def respond(self, request: Request, session, started: int):
        self.requests.append(request)
        self.threads.append(threading.get_ident())
        if self.opens_session:
            session.set("count", 1)
        reply = Reply()
        self.replies.append(reply)
        return Response(
            200,
            {"Content-Type": ["text/plain; charset=utf-8"], "X-Answer": "given"},
            f"{request.method} {request.path()}",
        ), reply

    def disconnected(self, request: Request, started: int, reply) -> None:
        self.disconnected_calls.append((request, reply))


def record_ended(written: list):
    """The write hook that appends (request, ended) of each write to `written`."""
    return lambda request, response, ended, elapsed, failure: written.append(
        (request, ended)
    )


def record_status(written: list):
    """The write hook that appends (path, status, ended) of each write to `written`."""
    return lambda request, response, ended, elapsed, failure: written.append(
        (request.path(), response.status, ended)
    )


def record_failure(written: list):
    """The write hook that appends (status, ended, failure) of each write to `written`."""
    return lambda request, response, ended, elapsed, failure: written.append(
        (response.status, ended, failure)
    )


def record_all(written: list):
    """The write hook that appends (method, path, status, ended, failure) of each write to `written`."""
    return lambda request, response, ended, elapsed, failure: written.append(
        (request.method, request.path(), response.status, ended, failure)
    )


def get_once(server, path: str):
    """Serves `server` in a thread for one GET of `path`, stops it and returns the reply and its body."""
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        connection = http.client.HTTPConnection(
            "127.0.0.1", server.server_address[1], timeout=10
        )
        connection.request("GET", path)
        reply = connection.getresponse()
        body = reply.read()
        connection.close()
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=10)
    return reply, body


class TransportCase(unittest.TestCase):
    """A test with the application and the file sessions of a directory that the test removes."""

    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.sessions = FileSessions(str(Path(self.directory.name).resolve()))
        self.app = Application()

    def assert_request_reached(self, cookie: str) -> None:
        """Requires that the application got the POST of the request of the tests, whose cookie `cookie` is `s`."""
        request = self.app.requests[0]
        self.assertEqual("POST", request.method)
        self.assertEqual("/news", request.path())
        self.assertEqual("page=2", request.raw_query())
        self.assertEqual("one", request.header("x-name"))
        self.assertEqual("s", request.cookie(cookie))
        self.assertEqual(5, request.body_size())

    def assert_disconnected(self, written: list) -> None:
        """Requires that the write was reported once as not ended, and the disconnect hook ran with that request."""
        self.assertEqual([(self.app.requests[0], False)], written)
        self.assertEqual(
            [(self.app.requests[0], self.app.replies[0])],
            self.app.disconnected_calls,
        )
