# A server opens the session of a request only for a route that uses it (HY-104.38): a request of
# a route that the manifest declares with `"session": false` takes no lock of a session and answers
# while another request holds it.
import asyncio
import json
import tempfile
import threading
import unittest
from pathlib import Path

from .render.fixture_handlers import FIXTURES, Counter, fixture_app, handlers
from polyspec.hyper.host.asgi import create_asgi
from polyspec.hyper.session.file_sessions import FileSessions

COOKIE = b"hy-session=" + b"a" * 32


def _scope(path: str) -> dict:
    return {
        "type": "http",
        "method": "GET",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "headers": [(b"cookie", COOKIE)],
    }


async def _receive() -> dict:
    return {"type": "http.request", "body": b"", "more_body": False}


class SessionRoutesTest(unittest.TestCase):
    def test_a_request_of_a_route_without_a_session_answers_while_the_session_is_held(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manifest = json.loads((FIXTURES / "app.json").read_text())
            # The route `item` of the fixture, whose program the fixture builds, uses no session; a route that the
            # program does not hold could not render.
            for route in manifest["routes"]:
                if route["name"] == "item":
                    route["session"] = False
            (Path(directory) / "app.json").write_text(json.dumps(manifest))
            (Path(directory) / "sessions").mkdir()
            entered = threading.Event()
            released = threading.Event()

            def held() -> dict:
                entered.set()
                released.wait()
                return {"name": "held"}

            given = handlers()
            given["regions"] = {"side": lambda: {"count": 0, "note": None}}
            given["routes"]["home"] = {"load": held}
            app = fixture_app(
                Counter(), handlers=given, manifest=str(Path(directory) / "app.json")
            )
            order: list[str] = []

            class Observed:
                """The library store of the sessions, whose second open is the failure that the test
                states: it would wait for the lock of the held request, so it releases that request
                first and the order of the answers shows the failure instead of a wait without an
                end."""

                opens = 0

                def __init__(self, store):
                    self.store = store

                def open(self, cookie):
                    Observed.opens += 1
                    if Observed.opens == 2:
                        order.append("plain opened the session")
                        released.set()
                    return self.store.open(cookie)

            sessions = FileSessions(str(Path(directory) / "sessions"))
            sessions.library = Observed(sessions.library)
            application = create_asgi(app, sessions)

            async def request(path: str, name: str) -> None:
                events: list[dict] = []

                async def send(event: dict) -> None:
                    events.append(event)

                await application(_scope(path), _receive, send)
                order.append(f"{name} {events[0]['status']}")

            async def both() -> None:
                first = asyncio.ensure_future(request("/", "held"))
                await asyncio.to_thread(entered.wait)
                await request("/items/1", "plain")
                released.set()
                await first

            asyncio.run(both())
            self.assertEqual(["plain 200", "held 200"], order)
