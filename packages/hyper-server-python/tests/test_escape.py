# An error that escapes the answer of a request (HY-60, HY-97, HY-99): the server writes no response and calls no write
# hook for it, so that every response that it writes reaches `written` with its request.
import http.client
import tempfile
import threading
import unittest
from pathlib import Path

from polyspec.hyper.file_sessions import FileSessions
from polyspec.hyper.server import create_server


class FailingApplication:
    """An application whose respond fails outside its own handling, as a failing response hook does (HY-60)."""

    https = False
    body_limit = 1024

    def respond(self, request, session, started):
        raise RuntimeError('hook boom')

    def disconnected(self, request, started, reply) -> None:
        pass


class EscapeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.sessions = FileSessions(str(Path(self.directory.name).resolve()))

    def test_an_error_that_escapes_the_answer_writes_no_response_and_no_write_hook(self) -> None:
        written: list = []
        server = create_server(FailingApplication(), self.sessions, host='127.0.0.1', port=0,
                               written=lambda *args: written.append(args))
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            connection = http.client.HTTPConnection('127.0.0.1', server.server_address[1], timeout=10)
            connection.request('GET', '/list')
            with self.assertRaises(http.client.RemoteDisconnected):
                connection.getresponse()
            connection.close()
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=10)
        self.assertEqual([], written)


if __name__ == '__main__':
    unittest.main()
