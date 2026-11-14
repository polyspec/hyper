# The field lines of a request (HY-42.7 to HY-42.12): `create_server` and the ASGI callable receive the lines of a name
# apart and read them as one value joined with `, `, the media type of the body included; the WSGI callable takes the
# value that its server joined as given; and `create_server` refuses a body that it cannot read by that one value.
import asyncio
import io
import socket
import threading

from .transport import TransportCase
from polyspec.hyper.host.asgi import create_asgi
from polyspec.hyper.host.server import create_server
from polyspec.hyper.host.wsgi import create_wsgi

# Two lines of `Content-Type` and two of `User-Agent`, as a client sends them.
LINES = [
    ("Content-Type", "application/x-www-form-urlencoded"),
    ("Content-Type", "text/plain"),
    ("User-Agent", "a"),
    ("User-Agent", "b"),
]
JOINED = "application/x-www-form-urlencoded, text/plain"
# What the request gives: the two headers, the media type of the body and the form values, of which a body of the
# joined type has none.
SEEN = [JOINED, JOINED, "a, b", []]


def exchange(server, data: bytes) -> bytes:
    """Serves `server` in a thread for one connection that sends `data`, and returns what the server wrote until it
    closed the connection."""
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    chunks: list[bytes] = []
    try:
        address = ("127.0.0.1", server.server_address[1])
        with socket.create_connection(address) as connection:
            connection.sendall(data)
            while chunk := connection.recv(65536):
                chunks.append(chunk)
    finally:
        server.shutdown()
        server.server_close()
        worker.join()
    return b"".join(chunks)


def status(answer: bytes) -> int:
    """Returns the status code of the status line of `answer`, which `http.server` writes as HTTP/1.0."""
    return int(answer.split(b" ", 2)[1])


def head(lines: list[tuple[str, str]]) -> bytes:
    """Returns the header lines of `lines` as a client writes them."""
    return b"".join(f"{name}: {value}\r\n".encode("latin-1") for name, value in lines)


class HeaderLinesTest(TransportCase):
    def seen(self) -> list:
        """Returns what the one request that reached the application gives of the lines of `LINES`."""
        [request] = self.app.requests
        return [
            request.header("Content-Type"),
            request.media_type(),
            request.header("User-Agent"),
            request.form(),
        ]

    def test_create_server_reads_the_lines_of_a_name_as_one_value(self) -> None:
        answer = exchange(
            create_server(self.app, self.sessions, host="127.0.0.1", port=0),
            b"POST /add HTTP/1.1\r\nHost: x\r\n"
            + head(LINES)
            + b"Content-Length: 3\r\nConnection: close\r\n\r\na=1",
        )
        self.assertEqual(200, status(answer))
        self.assertEqual(SEEN, self.seen())

    def test_the_asgi_callable_reads_the_lines_of_a_name_as_one_value(self) -> None:
        scope = {
            "type": "http",
            "method": "POST",
            "path": "/add",
            "raw_path": b"/add",
            "query_string": b"",
            "headers": [
                (name.lower().encode("latin-1"), value.encode("latin-1"))
                for name, value in LINES + [("Content-Length", "3")]
            ],
        }
        events: list[dict] = []

        async def receive() -> dict:
            return {"type": "http.request", "body": b"a=1", "more_body": False}

        async def send(event: dict) -> None:
            events.append(event)

        asyncio.run(create_asgi(self.app, self.sessions)(scope, receive, send))
        self.assertEqual(200, events[0]["status"])
        self.assertEqual(SEEN, self.seen())

    def test_the_wsgi_callable_takes_the_value_that_its_server_joined(self) -> None:
        environ = {
            "REQUEST_METHOD": "POST",
            "RAW_URI": "/add",
            "PATH_INFO": "/add",
            "QUERY_STRING": "",
            "CONTENT_TYPE": JOINED,
            "CONTENT_LENGTH": "3",
            "HTTP_USER_AGENT": "a, b",
            "wsgi.input": io.BytesIO(b"a=1"),
        }
        status: list[str] = []
        b"".join(
            create_wsgi(self.app, self.sessions)(
                environ, lambda line, headers, exc_info=None: status.append(line)
            )
        )
        self.assertEqual(["200 OK"], status)
        self.assertEqual(SEEN, self.seen())

    def test_create_server_refuses_two_content_length_lines(self) -> None:
        answer = exchange(
            create_server(self.app, self.sessions, host="127.0.0.1", port=0),
            b"POST /add HTTP/1.1\r\nHost: x\r\nContent-Length: 3\r\nContent-Length: 3\r\n"
            b"Connection: close\r\n\r\na=1",
        )
        self.assertEqual(400, status(answer))
        self.assertEqual([], self.app.requests)

    def test_create_server_refuses_two_transfer_encoding_lines(self) -> None:
        answer = exchange(
            create_server(self.app, self.sessions, host="127.0.0.1", port=0),
            b"POST /add HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\nTransfer-Encoding: chunked\r\n"
            b"Connection: close\r\n\r\n3\r\na=1\r\n0\r\n\r\n",
        )
        self.assertEqual(400, status(answer))
        self.assertEqual([], self.app.requests)
