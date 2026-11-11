"""What the tests of the ASGI callable (HY-100) and of the WSGI callable (HY-100) share: the application that they run,
the set-up of a test, the hooks that record what the write hook reports and the checks of a request that reached the
application."""

import http.client
import os
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
    # The form types of the application, which tell a transport whether it reads a multipart body in chunks (HY-131).
    _form_types = ["application/x-www-form-urlencoded"]

    def __init__(self, opens_session: bool = False):
        self.requests: list[Request] = []
        self.replies: list[object] = []
        self.disconnected_calls: list[tuple[Request, object]] = []
        self.threads: list[int] = []
        self.opens_session = opens_session

    def _respond(self, request: Request, session, started: int):
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

    def _disconnected(self, request: Request, started: int, reply) -> None:
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


def multipart_part(disposition: str, content: bytes) -> bytes:
    """Returns a part of a multipart body with the boundary XyZ."""
    return (
        b"--XyZ\r\nContent-Disposition: "
        + disposition.encode("latin-1")
        + b"\r\n\r\n"
        + content
        + b"\r\n"
    )


class Upload:
    """The set-up of a test of a multipart body that a transport reads in chunks (HY-131): the temporary directory of
    the system is a directory of the test, the application has the multipart form type, records what its request
    gives and moves the file `f` when `move` is true, and the write hook records the entries of the directory."""

    def __init__(self, case: unittest.TestCase, app: Application, move: bool):
        self.uploads = tempfile.mkdtemp(prefix="hyper-uploads-")
        previous = tempfile.tempdir
        tempfile.tempdir = self.uploads
        case.addCleanup(self._restore, previous)
        self.seen: list = []
        self.at_hook: list[str] = []
        app.body_limit = 4 * 1024 * 1024
        app._form_types = ["application/x-www-form-urlencoded", "multipart/form-data"]
        respond = app._respond

        def record(request: Request, session, started: int):
            uploaded = request.file("f")
            self.seen = [
                request.valid_input(),
                request.form(),
                None if uploaded is None else uploaded.filename(),
                None if uploaded is None else uploaded.size(),
                len(os.listdir(self.uploads)),
            ]
            if move and uploaded is not None:
                uploaded.move_to(os.path.join(self.uploads, "kept.bin"))
            return respond(request, session, started)

        app._respond = record

    def written(self, request, response, ended, elapsed, failure) -> None:
        """The write hook: records the entries of the directory, a directory of a request as `hyper-`."""
        self.at_hook = sorted(
            "hyper-" if name.startswith("hyper-") else name
            for name in os.listdir(self.uploads)
        )

    def entries(self) -> list[str]:
        """Returns the entries of the directory."""
        return sorted(os.listdir(self.uploads))

    def _restore(self, previous) -> None:
        tempfile.tempdir = previous
        for name in os.listdir(self.uploads):
            os.unlink(os.path.join(self.uploads, name))
        os.rmdir(self.uploads)
