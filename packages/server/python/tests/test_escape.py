# An error that escapes the answer of a request after the status line and the headers left the `http.server` server
# (HY-60, HY-99): the write hook receives the response that started, with ended false. The plain 500 of an escaped
# error and a failed session open are scenarios of tests/scripts/upload-servers.test.mts.
import contextlib
import io
import unittest

from .transport import TransportCase, get_once, record_all
from polyspec.hyper.app import App
from polyspec.hyper.reply import Reply
from polyspec.hyper.response import Response
from polyspec.hyper.server import create_server


class AnsweringApplication:
    """An application that answers every request with a page and records nothing."""

    https = False
    frame_ancestors = "'self'"
    # The frame policy and the log line of the plain 500, which the pipeline asks the application for (HY-60).
    _frame = App._frame
    _log_failure = App._log_failure
    body_limit = 1024
    _form_types = ["application/x-www-form-urlencoded"]
    file_limit = 1 << 30
    _value_limit = 1 << 30
    _part_limit = 1000

    def _respond(self, request, session, started):
        return Response(
            200, {"Content-Type": ["text/plain; charset=utf-8"]}, "page"
        ), Reply()

    def _disconnected(self, request, started, reply) -> None:
        pass


class EscapeTest(TransportCase):
    def get(self, server, path: str):
        # The server logs an escaped error to the standard error, which would interrupt the line of the verbose runner.
        with contextlib.redirect_stderr(io.StringIO()):
            return get_once(server, path)

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
            written=record_all(written),
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
