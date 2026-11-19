# The WSGI application callable (HY-100): the pipeline of the Python server as a callable that a
# WSGI server runs, with the public files, the body limit (HY-59), the session cookie of a new
# session (HY-45), the request hook `around` (HY-97), the write hook `written` (HY-99) and the
# disconnect hook on a write that a premature close of the body iterable ends (HY-67).
import contextlib
import io
import tempfile
import unittest
from pathlib import Path

from .transport import (
    HTTPS_CASES,
    https_application,
    Application,
    TransportCase,
    closed_public_directory,
    record_ended,
    record_failure,
    record_status,
    Upload,
    UploadCases,
)
from .render.fixture_handlers import Counter, fixture_app, handlers
from polyspec.hyper.session.file_sessions import FileSessions
from polyspec.hyper.http.reply import Reply
from polyspec.hyper.http.response import Response
from polyspec.hyper.host.wsgi import create_wsgi


def environ(**changes) -> dict:
    values = {"REQUEST_METHOD": "GET", "RAW_URI": "/", "wsgi.input": Input(b"")}
    values.update(changes)
    return values


class Input:
    """The `wsgi.input` of a request body."""

    def __init__(self, data: bytes):
        self.data = data
        self.reads: list[int] = []

    def read(self, size: int) -> bytes:
        self.reads.append(size)
        part, self.data = self.data[:size], self.data[size:]
        return part


def consume(body) -> bytes:
    """Consumes the whole body iterable and then calls its `close()` when it has one, as PEP 3333 requires a WSGI
    server to do."""
    try:
        return b"".join(body)
    finally:
        close = getattr(body, "close", None)
        if close is not None:
            close()


def call(application, values: dict) -> tuple[str, list[tuple[str, str]], bytes]:
    """Runs the callable as a WSGI server does: it consumes the whole body iterable and closes it."""
    head: list = []

    def start(status, headers, exc_info=None):
        head[:] = [status, headers]

    body = consume(application(values, start))
    return head[0], head[1], body


def refusing_start(calls: list):
    """A start_response that appends (status, exc_info) of each call to `calls` and raises on the first call."""

    def start(status, headers, exc_info=None):
        calls.append((status, exc_info))
        if len(calls) == 1:
            raise ValueError("the server refuses the headers")

    return start


def half_call(application, values: dict) -> None:
    """Runs the callable as a WSGI server does that stops early: it closes the body iterable before
    its end, which PEP 3333 defines as premature termination (HY-67)."""
    body = application(values, lambda status, headers, exc_info=None: None)
    next(iter(body))
    body.close()


class WsgiTest(UploadCases, TransportCase):
    def escape_with(self, response: Response) -> str:
        """Requires that the application's answer `response` is an escape that gets the plain 500, ended and reported
        once to the write hook, and returns the failure that the hook received."""
        written = []
        app = Application()
        app._respond = lambda request, session, started: (response, Reply())
        application = create_wsgi(
            app,
            self.sessions,
            written=record_failure(written),
        )
        with contextlib.redirect_stderr(io.StringIO()):
            status, _, body = call(application, environ(RAW_URI="/"))
        self.assertEqual("500 Internal Server Error", status)
        self.assertEqual(b"Internal Server Error", body)
        self.assertEqual(1, len(written))
        self.assertEqual((500, True), written[0][:2])
        return written[0][2]

    def test_the_request_reaches_the_application(self) -> None:
        written = []
        application = create_wsgi(
            self.app,
            self.sessions,
            around=None,
            written=lambda request, response, ended, elapsed, failure: written.append(
                (request, response, ended)
            ),
        )
        status, _, body = call(
            application,
            environ(
                REQUEST_METHOD="POST",
                RAW_URI="/news?page=2",
                CONTENT_LENGTH="5",
                CONTENT_TYPE="application/x-www-form-urlencoded",
                HTTP_COOKIE="a=1; consumer=s",
                HTTP_X_NAME="one",
                **{"wsgi.input": Input(b"a=hey")},
            ),
        )
        self.assertEqual("200 OK", status)
        self.assertEqual(b"POST /news", body)
        self.assert_request_reached("consumer")
        request = self.app.requests[0]
        self.assertEqual("hey", request.form_string("a"))

    def test_a_new_session_sets_its_cookie_first(self) -> None:
        self.app.opens_session = True
        application = create_wsgi(self.app, self.sessions)
        _, headers, _ = call(application, environ())
        self.assertEqual(
            [
                ("Content-Type", "text/plain; charset=utf-8"),
                ("X-Answer", "given"),
                ("Set-Cookie", self.cookie(headers)),
                ("Content-Length", "5"),
            ],
            headers,
        )

    def test_the_request_is_https_when_the_application_or_the_server_says_so(
        self,
    ) -> None:
        # The request is HTTPS when the application was opened with https or `wsgi.url_scheme` is https, and the
        # cookie of a new session then has the name and the attribute of HTTPS (HY-45).
        for opened, scheme, https in HTTPS_CASES:
            with self.subTest(opened=opened, scheme=scheme):
                app = https_application(opened)
                application = create_wsgi(app, self.sessions)
                _, headers, _ = call(
                    application, environ(**{"wsgi.url_scheme": scheme})
                )
                self.assertIs(https, app.requests[0].https)
                cookies = [value for name, value in headers if name == "Set-Cookie"]
                self.assertEqual(1, len(cookies))
                self.assertEqual(https, cookies[0].startswith("__Host-hy-session="))
                self.assertEqual(https, "; Secure" in cookies[0])
                self.assertEqual(not https, cookies[0].startswith("hy-session="))

    def test_the_method_reaches_the_application_in_upper_case(self) -> None:
        # HY-100.31: the host passes the method in upper case.
        app = Application()
        call(create_wsgi(app, self.sessions), environ(REQUEST_METHOD="purge"))
        self.assertEqual("PURGE", app.requests[0].method)

    def cookie(self, headers: list) -> str:
        set_cookies = [value for name, value in headers if name == "Set-Cookie"]
        self.assertEqual(1, len(set_cookies))
        self.assertTrue(set_cookies[0].startswith("hy-session="))
        return set_cookies[0]

    def test_a_body_over_the_limit_reads_no_more(self) -> None:
        # HY-100: the callable reads the body up to the body limit of the application and no more (HY-59).
        application = create_wsgi(self.app, self.sessions)
        input = Input(b"0123456789abcdef0123456789")
        call(
            application,
            environ(
                REQUEST_METHOD="POST", CONTENT_LENGTH="25", **{"wsgi.input": input}
            ),
        )
        request = self.app.requests[0]
        self.assertEqual(25, request.body_size())
        self.assertLessEqual(sum(input.reads), self.app.body_limit)

    def upload(self, upload: Upload, body: bytes) -> None:
        """Sends the multipart body through the callable with the write hook of the upload."""
        call(
            create_wsgi(self.app, self.sessions, written=upload.written),
            environ(
                REQUEST_METHOD="POST",
                CONTENT_TYPE="multipart/form-data; boundary=XyZ",
                CONTENT_LENGTH=str(len(body)),
                **{"wsgi.input": Input(body)},
            ),
        )

    def test_a_public_file_is_served_before_around(self) -> None:
        files = Path(self.directory.name) / "public"
        files.mkdir()
        (files / "a.css").write_text("body{}", encoding="utf-8")
        around_calls = []
        application = create_wsgi(
            self.app,
            self.sessions,
            files=str(files),
            around=lambda request, answer: around_calls.append(request),
        )
        status, headers, body = call(application, environ(RAW_URI="/a.css"))
        self.assertEqual("200 OK", status)
        self.assertEqual("text/css; charset=utf-8", dict(headers)["Content-Type"])
        self.assertEqual(b"body{}", body)
        self.assertEqual([], self.app.requests)
        self.assertEqual([], around_calls)

    def test_the_write_hook_reports_the_end(self) -> None:
        written = []
        application = create_wsgi(
            self.app,
            self.sessions,
            written=lambda request, response, ended, elapsed, failure: written.append(
                (request, ended, elapsed >= 0.0)
            ),
        )
        call(application, environ())
        self.assertEqual([(self.app.requests[0], True, True)], written)

    def test_the_write_hook_reports_a_premature_close_and_disconnects(self) -> None:
        written = []
        application = create_wsgi(
            self.app,
            self.sessions,
            written=record_ended(written),
        )
        half_call(application, environ())
        self.assert_disconnected(written)

    def test_around_answers_without_the_application(self) -> None:
        application = create_wsgi(
            self.app,
            self.sessions,
            around=lambda request, answer: Response(204, {}, ""),
        )
        status, headers, body = call(application, environ())
        self.assertEqual("204 No Content", status)
        self.assertEqual([], headers)
        self.assertEqual(b"", body)
        self.assertEqual([], self.app.requests)

    def test_the_raw_target_is_used_and_not_the_decoded_path_info(self) -> None:
        # HY-100: PATH_INFO is percent-decoded by the server; the path is the target as sent.
        cases = [
            ("/notes/a%20b", "/notes/a b", "/notes/a%20b", ""),
            ("/notes/a%2Fb", "/notes/a/b", "/notes/a%2Fb", ""),
            ("/caf%C3%A9?q=%E2%82%AC", "/caf\xc3\xa9", "/caf%C3%A9", "q=%E2%82%AC"),
        ]
        application = create_wsgi(self.app, self.sessions)
        for target, decoded, path, query in cases:
            with self.subTest(target=target):
                call(application, environ(RAW_URI=target, PATH_INFO=decoded))
                self.assertEqual(
                    (path, query),
                    (self.app.requests[-1].path(), self.app.requests[-1].raw_query()),
                )

    def test_request_uri_is_read_when_raw_uri_is_absent(self) -> None:
        # HY-100: uWSGI and mod_wsgi give REQUEST_URI.
        application = create_wsgi(self.app, self.sessions)
        call(
            application,
            {
                "REQUEST_METHOD": "GET",
                "REQUEST_URI": "/notes/a%20b?x=1",
                "PATH_INFO": "/notes/a b",
                "wsgi.input": Input(b""),
            },
        )
        self.assertEqual(
            ("/notes/a%20b", "x=1"),
            (self.app.requests[0].path(), self.app.requests[0].raw_query()),
        )

    def test_a_missing_target_answers_the_plain_failure_and_reports_nothing(
        self,
    ) -> None:
        # HY-100: PATH_INFO is never re-encoded into a path; the request has no target, so no request is reported.
        written = []
        application = create_wsgi(
            self.app,
            self.sessions,
            written=lambda request, response, ended, elapsed, failure: written.append(
                request
            ),
        )
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            status, headers, body = call(
                application,
                {
                    "REQUEST_METHOD": "GET",
                    "PATH_INFO": "/notes/a b",
                    "wsgi.input": Input(b""),
                },
            )
        self.assertEqual("500 Internal Server Error", status)
        self.assertEqual(b"Internal Server Error", body)
        self.assertIn(("Cache-Control", "no-store"), headers)
        self.assertIn(("Content-Security-Policy", "frame-ancestors 'self'"), headers)
        self.assertIn("RAW_URI", stderr.getvalue())
        self.assertIn("REQUEST_URI", stderr.getvalue())
        self.assertEqual([], self.app.requests)
        self.assertEqual([], written)

    def test_a_failed_body_read_answers_the_plain_failure_and_reports_the_request(
        self,
    ) -> None:
        # HY-60: a body that cannot be read is an escaped error before `around`; the write hook receives the request
        # as the server received it, with an empty body and the size that the client declared.
        written = []
        application = create_wsgi(
            self.app,
            self.sessions,
            written=lambda request, response, ended, elapsed, failure: written.append(
                (request, response, ended)
            ),
        )
        with contextlib.redirect_stderr(io.StringIO()):
            status, headers, body = call(
                application,
                environ(
                    REQUEST_METHOD="POST",
                    RAW_URI="/news",
                    CONTENT_LENGTH="5",
                    **{"wsgi.input": BrokenInput()},
                ),
            )
        self.assertEqual("500 Internal Server Error", status)
        self.assertEqual(b"Internal Server Error", body)
        self.assertEqual([], self.app.requests)
        self.assertEqual(1, len(written))
        request, response, ended = written[0]
        self.assertEqual(("POST", "/news"), (request.method, request.path()))
        self.assertEqual(5, request.body_size())
        self.assertEqual(500, response.status)
        self.assertTrue(ended)

    def test_an_around_error_answers_the_plain_failure_and_reports_the_request(
        self,
    ) -> None:
        # HY-97, HY-60: an error that `around` raises outside `answer` is an escaped error.
        written = []

        def around(request, answer):
            raise RuntimeError("around boom")

        application = create_wsgi(
            self.app,
            self.sessions,
            around=around,
            written=record_status(written),
        )
        with contextlib.redirect_stderr(io.StringIO()) as stderr:
            status, _, body = call(application, environ(RAW_URI="/list"))
        self.assertEqual("500 Internal Server Error", status)
        self.assertEqual(b"Internal Server Error", body)
        self.assertIn("around boom", stderr.getvalue())
        self.assertEqual([("/list", 500, True)], written)

    def test_a_premature_close_of_the_plain_failure_reports_a_failed_write(
        self,
    ) -> None:
        # HY-60, HY-99: the server closes the iterable of the 500 before its end; the write failed and is reported once.
        written = []

        def around(request, answer):
            raise RuntimeError("around boom")

        application = create_wsgi(
            self.app,
            self.sessions,
            around=around,
            written=lambda request, response, ended, elapsed, failure: written.append(
                (response.status, ended)
            ),
        )
        with contextlib.redirect_stderr(io.StringIO()):
            half_call(application, environ(RAW_URI="/list"))
        self.assertEqual([(500, False)], written)
        self.assertEqual([], self.app.disconnected_calls)

    def test_closing_the_body_before_its_first_item_reports_an_unended_write(
        self,
    ) -> None:
        # HY-99: a server that closes the iterable before its first item ends the write before it started.
        written = []
        application = create_wsgi(
            self.app,
            self.sessions,
            written=record_failure(written),
        )
        body = application(
            environ(RAW_URI="/"), lambda status, headers, exc_info=None: None
        )
        body.close()
        self.assertEqual([(200, False, None)], written)

    def test_a_body_that_cannot_be_encoded_is_an_escape_answered_with_the_plain_failure(
        self,
    ) -> None:
        # HY-60, HY-99: the body encode error is an escape; the plain 500 goes through start_response, and the write
        # hook receives it with the failure.
        failure = self.escape_with(Response(200, {}, "\ud800"))
        self.assertIn("surrogates", failure)

    def test_a_status_that_cannot_be_written_is_an_escape_answered_with_the_plain_failure(
        self,
    ) -> None:
        # HY-60, HY-99: a status that PEP 3333 cannot write is an escape; the plain 500 goes through start_response.
        self.assertTrue(self.escape_with(Response(1000, {}, "x")))

    def test_a_header_that_cannot_be_encoded_is_an_escape_answered_with_the_plain_failure(
        self,
    ) -> None:
        # HY-60, HY-99: a header value that PEP 3333 cannot write as latin-1 is an escape, and no other header reaches
        # start_response.
        heads = []
        infos = []
        app = Application()
        app._respond = lambda request, session, started: (
            Response(200, {"X-Euro": "a\u20ac"}, "x"),
            Reply(),
        )
        application = create_wsgi(app, self.sessions)

        def start(status, headers, exc_info=None):
            heads.append((status, headers))
            infos.append(exc_info)

        with contextlib.redirect_stderr(io.StringIO()):
            b"".join(application(environ(RAW_URI="/"), start))
        self.assertEqual(1, len(heads))
        self.assertEqual("500 Internal Server Error", heads[0][0])
        self.assertNotIn("X-Euro", [name for name, _ in heads[0][1]])
        # HY-100.9: the plain 500 of a header that cannot be encoded carries the exception information of the error.
        self.assertIsNotNone(infos[0])
        self.assertIsInstance(infos[0][1], UnicodeError)

    def test_a_start_response_that_raises_for_a_public_file_is_an_escape_answered_with_the_plain_failure(
        self,
    ) -> None:
        # HY-100.9, HY-60: a start_response that raises is an escape also for a file of the public directory; the
        # callable passes the plain 500 to start_response with the exception information, and the write hook
        # receives the failure once.
        files = Path(self.directory.name) / "public"
        files.mkdir()
        (files / "a.css").write_text("body{}", encoding="utf-8")
        written = []
        calls = []
        start = refusing_start(calls)
        application = create_wsgi(
            self.app,
            self.sessions,
            files=str(files),
            written=record_failure(written),
        )
        with contextlib.redirect_stderr(io.StringIO()):
            body = consume(application(environ(RAW_URI="/a.css"), start))
        self.assertEqual(b"Internal Server Error", body)
        self.assertEqual(
            ["200 OK", "500 Internal Server Error"], [status for status, _ in calls]
        )
        self.assertIsNotNone(calls[1][1])
        self.assertEqual([(500, True, "the server refuses the headers")], written)

    def test_a_failed_stat_of_a_public_file_is_an_escape_answered_with_the_plain_failure(
        self,
    ) -> None:
        # HY-60.14, HY-60.17: a stat of a file of the public directory that fails for another reason than a missing
        # file is an escaped error: the plain 500, and one call of the write hook with the request as received.
        files = closed_public_directory(self, self.directory.name)
        written = []
        application = create_wsgi(
            self.app, self.sessions, files=str(files), written=record_status(written)
        )
        with contextlib.redirect_stderr(io.StringIO()):
            status, _, body = call(application, environ(RAW_URI="/closed/a.css"))
        self.assertEqual(
            ("500 Internal Server Error", b"Internal Server Error"), (status, body)
        )
        self.assertEqual([("/closed/a.css", 500, True)], written)

    def test_a_start_response_that_raises_is_an_escape_answered_through_start_response_again(
        self,
    ) -> None:
        # HY-60, HY-99: a start_response that raises is an escape; the callable passes the plain 500 to start_response
        # with the exception information, and the write hook receives the failure.
        written = []
        calls = []
        start = refusing_start(calls)
        application = create_wsgi(
            self.app,
            self.sessions,
            written=record_failure(written),
        )
        with contextlib.redirect_stderr(io.StringIO()):
            body = consume(application(environ(RAW_URI="/"), start))
        self.assertEqual(b"Internal Server Error", body)
        self.assertEqual(2, len(calls))
        self.assertEqual("500 Internal Server Error", calls[1][0])
        self.assertIsNotNone(calls[1][1])
        self.assertEqual([(500, True, "the server refuses the headers")], written)

    def test_an_empty_response_reports_its_write_when_the_consumed_iterable_is_closed(
        self,
    ) -> None:
        # HY-99, HY-100.34: a 204 response has an empty body; its write is reported when the server closes the
        # iterable that it consumed, not at return and not at the end of the iteration.
        class NoContent(Application):
            def _respond(self, request, session, started):
                return Response(204, {}, ""), Reply()

        written = []
        application = create_wsgi(
            NoContent(),
            self.sessions,
            written=record_failure(written),
        )
        body = application(
            environ(RAW_URI="/"), lambda status, headers, exc_info=None: None
        )
        self.assertEqual([], written)
        self.assertEqual([b""], list(body))
        self.assertEqual([], written)
        body.close()
        self.assertEqual([(204, True, None)], written)

    def test_a_start_response_that_raises_again_reports_the_write_before_the_error_propagates(
        self,
    ) -> None:
        # HY-100.36: the callable returns no iterable, so it calls the write hook before the error of the second
        # `start_response` propagates.
        written = []

        def start(status, headers, exc_info=None):
            raise ValueError("the server refuses the headers")

        application = create_wsgi(
            self.app,
            self.sessions,
            written=record_failure(written),
        )
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(ValueError):
                application(environ(RAW_URI="/"), start)
        self.assertEqual([(500, False, "the server refuses the headers")], written)

    def close_events(self, consume_all: bool) -> list[str]:
        """Runs the callable as a WSGI server does that consumes the whole body iterable or stops after its first
        item, then calls `close()` twice, and returns the events in their order: the end of the iteration, the write
        hook with `ended`, the disconnect hook and each return of `close()`."""
        events: list[str] = []

        class Recording(Application):
            def _disconnected(self, request, started, reply) -> None:
                events.append("disconnect hook")

        application = create_wsgi(
            Recording(),
            self.sessions,
            written=lambda request, response, ended, elapsed, failure: events.append(
                f"written ended={ended}"
            ),
        )
        body = application(environ(), lambda status, headers, exc_info=None: None)
        if consume_all:
            for _ in body:
                pass
            events.append("iteration ended")
        else:
            next(iter(body))
        body.close()
        events.append("close returned")
        body.close()
        events.append("close returned")
        return events

    def test_close_runs_the_write_hook_of_a_write_that_ended(self) -> None:
        # HY-100.34, HY-100.35: the iterable reports the write in its `close()`, after the server consumed it, so the
        # hook has run when `close()` returns; a second `close()` calls no hook.
        self.assertEqual(
            [
                "iteration ended",
                "written ended=True",
                "close returned",
                "close returned",
            ],
            self.close_events(True),
        )

    def test_close_runs_the_write_hook_and_the_disconnect_hook_of_a_write_that_failed(
        self,
    ) -> None:
        # HY-100.34, HY-100.35: a `close()` before the end calls the write hook and then the disconnect hook, and
        # returns after both; a second `close()` calls no hook.
        self.assertEqual(
            [
                "written ended=False",
                "disconnect hook",
                "close returned",
                "close returned",
            ],
            self.close_events(False),
        )


class BaseExceptionTest(unittest.TestCase):
    def test_an_exception_that_is_no_exception_passes_through_the_application_and_the_callable(
        self,
    ) -> None:
        # HY-43 (python-base-exception): SystemExit is no error of the application.
        reports: list = []
        written: list = []
        started: list = []

        def leave():
            raise SystemExit(3)

        given = handlers()
        given["routes"]["home"]["load"] = leave
        app = fixture_app(
            Counter(), handlers=given, on_response=lambda *call: reports.append(call)
        )
        with tempfile.TemporaryDirectory(prefix="hyper-wsgi-") as directory:
            application = create_wsgi(
                app, FileSessions(directory), written=lambda *call: written.append(call)
            )
            with (
                contextlib.redirect_stderr(io.StringIO()) as log,
                self.assertRaises(SystemExit) as raised,
            ):
                application(environ(RAW_URI="/"), lambda *head: started.append(head))
        self.assertEqual(3, raised.exception.code)
        self.assertEqual(([], [], [], ""), (started, reports, written, log.getvalue()))


class BrokenInput:
    """A `wsgi.input` whose read fails, as a client that closed the connection makes it."""

    def read(self, size: int) -> bytes:
        raise OSError("the client closed the connection")
