# The `http.server` server of the package with a real socket on 127.0.0.1 and a port that the system assigns: the
# decoder of a body that is sent in chunks (HY-59.10) and the context in which `around` runs the answer (HY-97).
# tests/scripts/upload-servers.test.mts states the hooks of the three servers over HTTP.
import json
import shutil
import socket
import tempfile
import threading
import unittest
from pathlib import Path
from typing import Callable, Optional

from .fixture_app import FIXTURES
from polyspec.hyper.app import App
from polyspec.hyper.file_sessions import FileSessions
from polyspec.hyper.request import Request
from polyspec.hyper.response import Response
from polyspec.hyper import create_server

TESTS = Path(__file__).resolve().parents[2]
MANIFEST = TESTS.parent / "php" / "tests" / "fixtures" / "app.json"
# The read paths of the JSON responses of these tests; a JSON response renders no template (HY-73).
READS = {
    "routes": {"home": {"shared": True, "regions": {"side": True, "content": True}}}
}


def open_app(load: Callable, **options) -> App:
    """Opens a copy of the fixture manifest with a server program of its own: the read paths and an empty template
    directory, because a JSON response renders no template."""
    program = Path(tempfile.mkdtemp(prefix="hyper-program-"))
    try:
        manifest = program / "app.json"
        shutil.copyfile(MANIFEST, manifest)
        (program / "templates").mkdir()
        (program / "reads.json").write_text(json.dumps(READS), encoding="utf-8")
        shutil.copyfile(FIXTURES / "build.json", program / "build.json")
        handlers = {
            "regions": {"side": lambda: {}},
            "routes": {"home": {"load": load}, "add": {"post": lambda: None}},
        }
        return App.open(
            manifest=str(manifest),
            program=str(program),
            handlers=handlers,
            timezone="+09:00",
            **options,
        )
    finally:
        shutil.rmtree(program)


class Served:
    """Serves an application in a thread; leaving the block stops the server and awaits every request thread, so a
    test reads the calls of the hooks after every request ended (HR-87)."""

    def __init__(self, app: App, **options):
        self._sessions = tempfile.TemporaryDirectory(prefix="hyper-sessions-")
        try:
            self.server = create_server(
                app, FileSessions(self._sessions.name), **options
            )
        except Exception:
            self._sessions.cleanup()
            raise
        # A request thread that is not a daemon thread is awaited by `server_close`.
        self.server.daemon_threads = False
        self._thread = threading.Thread(target=self.server.serve_forever)

    def __enter__(self) -> "Served":
        self._thread.start()
        return self

    def __exit__(self, *_exc: object) -> None:
        self.server.shutdown()
        self._thread.join()
        self.server.server_close()
        self._sessions.cleanup()

    def connect(
        self, target: str = "/", headers: Optional[dict] = None
    ) -> socket.socket:
        """Opens a connection and sends a JSON GET request of the target."""
        client = socket.create_connection(self.server.server_address[:2])
        lines = [
            f"GET {target} HTTP/1.1",
            "Host: 127.0.0.1",
            "Accept: application/vnd.hyper+json",
            "Connection: close",
            *(f"{name}: {value}" for name, value in (headers or {}).items()),
        ]
        client.sendall(("\r\n".join(lines) + "\r\n\r\n").encode("latin-1"))
        return client


def read_all(client: socket.socket) -> bytes:
    """Reads the response until the server closes the connection."""
    chunks = []
    while chunk := client.recv(65536):
        chunks.append(chunk)
    client.close()
    return b"".join(chunks)


def parse(response: bytes) -> tuple[int, dict[str, list[str]], bytes]:
    """Returns the status, the headers by lower-case name and the body of a response."""
    head, _, body = response.partition(b"\r\n\r\n")
    lines = head.decode("latin-1").split("\r\n")
    headers: dict[str, list[str]] = {}
    for line in lines[1:]:
        name, _, value = line.partition(":")
        headers.setdefault(name.lower(), []).append(value.strip())
    return int(lines[0].split(" ")[1]), headers, body


class ChunkedBodyTest(unittest.TestCase):
    """The decoder of a body that the request sends in chunks (HY-59.10), beyond the body limit that
    tests/scripts/upload-servers.test.mts states for the three servers."""

    def setUp(self) -> None:
        # The form values of the bodies that `around` received with their sizes, and the statuses that the write hook
        # received.
        self.received: list[tuple[list, int]] = []
        self.written: list[int] = []

        def around(request: Request, answer: Callable) -> Response:
            self.received.append((request.form(), request.body_size()))
            return Response.text(200, "read")

        self.served = Served(
            open_app(lambda: {"name": "x"}),
            around=around,
            written=lambda request, response, ended, elapsed, failure: (
                self.written.append(response.status)
            ),
        )

    def status(self, body: bytes, coding: str = "chunked") -> int:
        """Sends a POST request of `/add` whose body is `body` as it stands, ends the sending side and returns the
        status of the response."""
        client = socket.create_connection(self.served.server.server_address[:2])
        client.sendall(
            b"POST /add HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n"
            b"Content-Type: application/x-www-form-urlencoded\r\nTransfer-Encoding: "
            + coding.encode("latin-1")
            + b"\r\n\r\n"
            + body
        )
        client.shutdown(socket.SHUT_WR)
        return parse(read_all(client))[0]

    def test_a_chunk_extension_and_trailer_fields_are_not_part_of_the_body(
        self,
    ) -> None:
        with self.served:
            status = self.status(
                b"3;name=value\r\na=1\r\nA\r\n&b=2345678\r\n0\r\n"
                b"Expires: never\r\nX-Sum: 1\r\n\r\n"
            )
        self.assertEqual(200, status)
        self.assertEqual([([("a", ["1"]), ("b", ["2345678"])], 13)], self.received)
        self.assertEqual([200], self.written)

    def test_a_body_that_is_not_in_chunks_is_answered_400_and_reaches_no_hook(
        self,
    ) -> None:
        bodies = {
            "a size line that is no hexadecimal number": b"x\r\nabc\r\n0\r\n\r\n",
            "a size line without digits": b";name=value\r\nabc\r\n0\r\n\r\n",
            "a size line that ends with a line feed alone": b"3\nabc\r\n0\r\n\r\n",
            "chunk data without its line end": b"3\r\nabcd\r\n0\r\n\r\n",
            "a body that ends inside a chunk": b"5\r\nabc",
            "a body that ends before its last chunk": b"3\r\nabc\r\n",
            "a trailer line that is no field": b"0\r\nno field\r\n\r\n",
            "a body that ends inside the trailer": b"0\r\nExpires: never\r\n",
        }
        with self.served:
            for label, body in bodies.items():
                with self.subTest(label):
                    self.assertEqual(400, self.status(body))
            with self.subTest("another transfer coding"):
                self.assertEqual(400, self.status(b"0\r\n\r\n", "gzip, chunked"))
        self.assertEqual([], self.received)
        self.assertEqual([], self.written)


class AroundTest(unittest.TestCase):
    def test_around_runs_the_answer_in_a_context_of_its_own(self) -> None:
        # HY-97: the loaders of the request run inside the call of `answer`, so they read the context of `around`.
        context = threading.local()
        seen: list = []

        def around(request: Request, answer: Callable) -> Response:
            context.request = request.header("X-Request-Id")
            try:
                return answer(request)
            finally:
                del context.request

        def load() -> dict:
            seen.append(getattr(context, "request", None))
            return {"name": "n"}

        with Served(open_app(load), around=around) as served:
            read_all(served.connect(headers={"X-Request-Id": "a"}))
            read_all(served.connect(headers={"X-Request-Id": "b"}))
        self.assertEqual(["a", "b"], seen)


if __name__ == "__main__":
    unittest.main()
