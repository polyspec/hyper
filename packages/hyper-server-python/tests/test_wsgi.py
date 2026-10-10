# The WSGI application callable (HY-100): the pipeline of the Python server as a callable that a
# WSGI server runs, with the public files, the body limit (HY-59), the session cookie of a new
# session (HY-45), the request hook `around` (HY-97), the write hook `written` (HY-99) and the
# disconnect hook on a write that a premature close of the body iterable ends (HY-67).
import tempfile
import unittest
from pathlib import Path

from polyspec.hyper.file_sessions import FileSessions
from polyspec.hyper.reply import Reply
from polyspec.hyper.request import Request
from polyspec.hyper.response import Response
from polyspec.hyper.wsgi import create_wsgi


class Application:
    """An application that answers with what the request gave, and records it and its replies."""

    https = False
    body_limit = 16

    def __init__(self, opens_session: bool = False):
        self.requests: list[Request] = []
        self.replies: list[object] = []
        self.disconnected_calls: list[tuple[Request, object]] = []
        self.opens_session = opens_session

    def respond(self, request: Request, session, started: int):
        self.requests.append(request)
        if self.opens_session:
            session.set('count', 1)
        reply = Reply()
        self.replies.append(reply)
        return Response(200, {'Content-Type': ['text/plain; charset=utf-8'],
                              'X-Answer': 'given'}, f'{request.method} {request.path()}'), reply

    def disconnected(self, request: Request, started: int, reply) -> None:
        self.disconnected_calls.append((request, reply))


def environ(**changes) -> dict:
    values = {'REQUEST_METHOD': 'GET', 'RAW_URI': '/', 'wsgi.input': Input(b'')}
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


def call(application, values: dict) -> tuple[str, list[tuple[str, str]], bytes]:
    """Runs the callable as a WSGI server does: it consumes the whole body iterable."""
    head: list = []

    def start(status, headers, exc_info=None):
        head[:] = [status, headers]

    body = b''.join(application(values, start))
    return head[0], head[1], body


def half_call(application, values: dict) -> None:
    """Runs the callable as a WSGI server does that stops early: it closes the body iterable before
    its end, which PEP 3333 defines as premature termination (HY-67)."""
    iterator = application(values, lambda status, headers, exc_info=None: None)
    next(iterator)
    iterator.close()


class WsgiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.sessions = FileSessions(str(Path(self.directory.name).resolve()))
        self.app = Application()

    def test_the_request_reaches_the_application(self) -> None:
        written = []
        application = create_wsgi(self.app, self.sessions, around=None,
                                  written=lambda request, response, ended, elapsed: written.append(
                                      (request, response, ended)))
        status, _, body = call(application, environ(
            REQUEST_METHOD='POST', RAW_URI='/news?page=2', CONTENT_LENGTH='5',
            CONTENT_TYPE='application/x-www-form-urlencoded',
            HTTP_COOKIE='a=1; limepie=s', HTTP_X_NAME='one',
            **{'wsgi.input': Input(b'a=hey')}))
        self.assertEqual('200 OK', status)
        self.assertEqual(b'POST /news', body)
        request = self.app.requests[0]
        self.assertEqual('POST', request.method)
        self.assertEqual('/news', request.path())
        self.assertEqual('page=2', request.raw_query())
        self.assertEqual('one', request.header('x-name'))
        self.assertEqual('s', request.cookie('limepie'))
        self.assertEqual(5, request.body_size())
        self.assertEqual('hey', request.form_string('a'))

    def test_a_new_session_sets_its_cookie_first(self) -> None:
        self.app.opens_session = True
        application = create_wsgi(self.app, self.sessions)
        _, headers, _ = call(application, environ())
        self.assertEqual([('Content-Type', 'text/plain; charset=utf-8'), ('X-Answer', 'given'),
                          ('Set-Cookie', self.cookie(headers)),
                          ('Content-Length', '5')], headers)

    def cookie(self, headers: list) -> str:
        set_cookies = [value for name, value in headers if name == 'Set-Cookie']
        self.assertEqual(1, len(set_cookies))
        self.assertTrue(set_cookies[0].startswith('hy-session='))
        return set_cookies[0]

    def test_a_body_over_the_limit_reads_no_more(self) -> None:
        # HY-100: the callable reads the body up to the body limit of the application and no more (HY-59).
        application = create_wsgi(self.app, self.sessions)
        input = Input(b'0123456789abcdef0123456789')
        call(application, environ(REQUEST_METHOD='POST', CONTENT_LENGTH='25', **{'wsgi.input': input}))
        request = self.app.requests[0]
        self.assertEqual(25, request.body_size())
        self.assertLessEqual(sum(input.reads), self.app.body_limit)

    def test_a_public_file_is_served_before_around(self) -> None:
        files = Path(self.directory.name) / 'public'
        files.mkdir()
        (files / 'a.css').write_text('body{}', encoding='utf-8')
        around_calls = []
        application = create_wsgi(self.app, self.sessions, files=str(files),
                                  around=lambda request, answer: around_calls.append(request))
        status, headers, body = call(application, environ(RAW_URI='/a.css'))
        self.assertEqual('200 OK', status)
        self.assertEqual('text/css; charset=utf-8', dict(headers)['Content-Type'])
        self.assertEqual(b'body{}', body)
        self.assertEqual([], self.app.requests)
        self.assertEqual([], around_calls)

    def test_the_write_hook_reports_the_end(self) -> None:
        written = []
        application = create_wsgi(self.app, self.sessions,
                                  written=lambda request, response, ended, elapsed: written.append(
                                      (request, ended, elapsed >= 0.0)))
        call(application, environ())
        self.assertEqual([(self.app.requests[0], True, True)], written)

    def test_the_write_hook_reports_a_premature_close_and_disconnects(self) -> None:
        written = []
        application = create_wsgi(self.app, self.sessions,
                                  written=lambda request, response, ended, elapsed: written.append(
                                      (request, ended)))
        half_call(application, environ())
        self.assertEqual([(self.app.requests[0], False)], written)
        self.assertEqual([(self.app.requests[0], self.app.replies[0])], self.app.disconnected_calls)

    def test_around_answers_without_the_application(self) -> None:
        application = create_wsgi(self.app, self.sessions,
                                  around=lambda request, answer: Response(204, {}, ''))
        status, headers, body = call(application, environ())
        self.assertEqual('204 No Content', status)
        self.assertEqual([], headers)
        self.assertEqual(b'', body)
        self.assertEqual([], self.app.requests)

    def test_the_raw_target_is_used_and_not_the_decoded_path_info(self) -> None:
        # HY-100: PATH_INFO is percent-decoded by the server; the path is the target as sent.
        cases = [('/notes/a%20b', '/notes/a b', '/notes/a%20b', ''),
                 ('/notes/a%2Fb', '/notes/a/b', '/notes/a%2Fb', ''),
                 ('/caf%C3%A9?q=%E2%82%AC', '/caf\xc3\xa9', '/caf%C3%A9', 'q=%E2%82%AC')]
        application = create_wsgi(self.app, self.sessions)
        for target, decoded, path, query in cases:
            with self.subTest(target=target):
                call(application, environ(RAW_URI=target, PATH_INFO=decoded))
                self.assertEqual((path, query), (self.app.requests[-1].path(), self.app.requests[-1].raw_query()))

    def test_request_uri_is_read_when_raw_uri_is_absent(self) -> None:
        # HY-100: uWSGI and mod_wsgi give REQUEST_URI.
        application = create_wsgi(self.app, self.sessions)
        call(application, {'REQUEST_METHOD': 'GET', 'REQUEST_URI': '/notes/a%20b?x=1',
                           'PATH_INFO': '/notes/a b', 'wsgi.input': Input(b'')})
        self.assertEqual(('/notes/a%20b', 'x=1'), (self.app.requests[0].path(), self.app.requests[0].raw_query()))

    def test_a_missing_target_fails_naming_both_keys(self) -> None:
        # HY-100: PATH_INFO is never re-encoded into a path; the request fails before start_response.
        application = create_wsgi(self.app, self.sessions)
        started: list = []
        with self.assertRaises(RuntimeError) as failure:
            application({'REQUEST_METHOD': 'GET', 'PATH_INFO': '/notes/a b', 'wsgi.input': Input(b'')},
                        lambda status, headers, exc_info=None: started.append(status))
        self.assertIn('RAW_URI', str(failure.exception))
        self.assertIn('REQUEST_URI', str(failure.exception))
        self.assertEqual([], started)
        self.assertEqual([], self.app.requests)
