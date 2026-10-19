# An error that escapes the answer of a request (HY-60, HY-97, HY-99): the server writes the plain 500 of hyper and reports
# it once to the write hook with the request as the server received it, also when `around` never ran.
import contextlib
import http.client
import io
import tempfile
import threading
import unittest
from pathlib import Path

from polyspec.hyper.file_sessions import FileSessions
from polyspec.hyper.reply import Reply
from polyspec.hyper.response import Response
from polyspec.hyper.server import create_server


class FailingApplication:
    """An application whose respond fails outside its own handling, as a failing response hook does (HY-60)."""

    https = False
    frame_ancestors = "'self'"
    body_limit = 1024

    def __init__(self):
        self.responds = 0

    def respond(self, request, session, started):
        self.responds += 1
        raise RuntimeError("hook boom")

    def disconnected(self, request, started, reply) -> None:
        pass


class AnsweringApplication:
    """An application that answers every request with a page and records nothing."""

    https = False
    frame_ancestors = "'self'"
    body_limit = 1024

    def respond(self, request, session, started):
        return Response(
            200, {"Content-Type": ["text/plain; charset=utf-8"]}, "page"
        ), Reply()

    def disconnected(self, request, started, reply) -> None:
        pass


class BrokenSessions:
    """A session store that fails to open, before the application and `around` run (HY-60)."""

    def open(self, identifier):
        raise OSError("the session directory is gone")


class EscapeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.sessions = FileSessions(str(Path(self.directory.name).resolve()))

    def get(self, server, path: str):
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

    def test_an_error_that_escapes_the_answer_gets_the_plain_500_and_one_write_report(
        self,
    ) -> None:
        application = FailingApplication()
        written: list = []
        server = create_server(
            application,
            self.sessions,
            host="127.0.0.1",
            port=0,
            written=lambda request, response, ended, elapsed, failure: written.append(
                (request.method, request.path(), response.status, ended, failure)
            ),
        )
        reply, body = self.get(server, "/list")
        # HY-60: the plain 500 of an escaped error is hyper's own response, the same in every adapter.
        self.assertEqual(500, reply.status)
        self.assertEqual(b"Internal Server Error", body)
        self.assertEqual("no-store", reply.getheader("Cache-Control"))
        self.assertEqual(
            "frame-ancestors 'self'", reply.getheader("Content-Security-Policy")
        )
        self.assertEqual("text/plain; charset=utf-8", reply.getheader("Content-Type"))
        self.assertEqual(1, application.responds)
        # HY-99: the write hook receives the 500 once, with the request; the response hook does not receive it.
        self.assertEqual([("GET", "/list", 500, True, "hook boom")], written)

    def test_a_failed_session_open_is_reported_before_the_application_runs(
        self,
    ) -> None:
        # HY-60: an error before `around` and the application is an escaped error; the write hook still receives
        # its request, because a consumer records every request that the server answers.
        application = FailingApplication()
        written: list = []
        server = create_server(
            application,
            BrokenSessions(),
            host="127.0.0.1",
            port=0,
            written=lambda request, response, ended, elapsed, failure: written.append(
                (request.method, request.path(), response.status, ended, failure)
            ),
        )
        reply, body = self.get(server, "/list")
        self.assertEqual(500, reply.status)
        self.assertEqual(b"Internal Server Error", body)
        self.assertEqual(0, application.responds)
        self.assertEqual(
            [("GET", "/list", 500, True, "the session directory is gone")], written
        )

    def test_a_write_that_fails_after_the_headers_started_reports_an_unended_write_with_its_failure(
        self,
    ) -> None:
        # HY-60, HY-99: the status line and the headers left the server before the write failed; the error escapes the
        # answer, the connection closes, and the write hook receives the response that started with ended false.
        application = AnsweringApplication()
        written: list = []
        server = create_server(
            application,
            self.sessions,
            host="127.0.0.1",
            port=0,
            written=lambda request, response, ended, elapsed, failure: written.append(
                (request.method, request.path(), response.status, ended, failure)
            ),
        )
        broken_send = server.RequestHandlerClass.send

        def send(handler, response) -> None:
            # The first part of a send writes the status line and the headers, then the body write fails.
            handler.send_response(200)
            handler.send_header("Content-Length", "0")
            handler.end_headers()
            raise OSError("the body write failed")

        server.RequestHandlerClass.send = send
        try:
            with contextlib.redirect_stderr(io.StringIO()):
                self.get(server, "/list")
        finally:
            server.RequestHandlerClass.send = broken_send
        self.assertEqual(
            [("GET", "/list", 200, False, "the body write failed")], written
        )


if __name__ == "__main__":
    unittest.main()
