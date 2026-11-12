# The client rendering beyond the cases of contracts/client.json (HY-62): the selection, the declaration and the fixtures that
# the cases run against.
import json
import tempfile
import unittest
from pathlib import Path

from .fixture_app import FIXTURES, PROGRAM
from polyspec.hyper.app import App
from polyspec.hyper.choice import Choice
from polyspec.hyper.client_rendering import ClientRendering
from polyspec.hyper.representation import Representation
from polyspec.hyper.request import Request
from polyspec.hyper.result import Result
from polyspec.hyper.array_session import ArraySession

SHELL = FIXTURES / "shell" / "index.html"
# A session token of HY-24; the form carries a masked value of it.
TOKEN = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
# The base path and the chosen host of the client rendering that the tests open by default (client.json).
BASE_PATH = "/_props"
CHOSEN_HOST = "client.test"


def default_client() -> ClientRendering:
    return ClientRendering(
        str(SHELL),
        BASE_PATH,
        lambda request: Choice(request.header("Host") == CHOSEN_HOST, None),
    )


class Counter:
    """A service that the fixture application reads and changes, and the calls of its representation handlers."""

    def __init__(self, header_names=()):
        self.count = 0
        self.actions = 0
        self.handled = 0
        self.received = None
        # The names of the request headers that a representation handler looks up in what it received.
        self.header_names = tuple(header_names)


def _handlers(counter: Counter, representations: dict) -> dict:
    def add(request: Request, counter: Counter) -> Result:
        counter.actions += 1
        if request.form_string("name") == "taken":
            return Result.page(409, {"name": "taken", "error": "conflict"})
        counter.count += 1
        return Result.redirect("/")

    def side(counter: Counter) -> dict:
        return {"count": counter.count, "note": None}

    def home_load(counter: Counter) -> dict:
        return {"name": f"n{counter.count}"}

    def rows() -> dict:
        return {
            "items": [],
            "open": False,
            "mode": "a",
            "view": "x",
            "filter": {"a": 1},
            "tags": [],
        }

    routes = {
        "home": {"load": home_load},
        "add": {"post": add},
        "list": {"regions": {"rows": rows}},
        "item": {"load": lambda request: {"id": request.param("id")}},
    }
    for name, entries in representations.items():
        routes.setdefault(name, {})["representations"] = {
            entry["type"]: _representation(counter, entry["handler"]) for entry in entries
        }
    return {"regions": {"side": side}, "routes": routes}


def _manifest(directory: str, representations: dict) -> Path:
    """Writes the manifest of the fixture application with the representations that the case declares for its routes."""
    manifest = json.loads((FIXTURES / "app.json").read_text(encoding="utf-8"))
    for route in manifest["routes"]:
        if route["name"] in representations:
            route["representations"] = [
                {key: value for key, value in entry.items() if key != "handler"}
                for entry in representations[route["name"]]
            ]
    path = Path(directory) / "app.json"
    path.write_text(json.dumps(manifest), encoding="utf-8")
    return path


def _representation(counter: Counter, response: dict):
    """Returns a representation handler that answers `response` and records its calls and what it receives (HY-122)."""

    def handler(request, media) -> Representation:
        counter.handled += 1
        counter.received = {
            "parameters": media.parameters(),
            "selection": request.selection(),
            "headers": {
                name: request.header(name)
                for name in counter.header_names
                if request.header(name) is not None
            },
        }
        return Representation(response["status"], response.get("body"), response.get("headers"))

    return handler


def app(
    counter: Counter,
    client: ClientRendering | None = None,
    representations: dict | None = None,
    **options,
) -> App:
    """Opens the fixture application with the client rendering `client`. `representations` declares the entries of the
    routes of a case (client.json), each with the response `handler` of its representation handler."""
    if client is None:
        client = default_client()
    with tempfile.TemporaryDirectory() as directory:
        manifest = _manifest(directory, representations) if representations else FIXTURES / "app.json"
        application = App.open(
            manifest=str(manifest),
            program=str(PROGRAM),
            handlers=_handlers(counter, representations or {}),
            timezone="+09:00",
            client_rendering=client,
            **options,
        )
    application.bind(Counter, lambda: counter)
    return application


class SelectionTest(unittest.TestCase):
    def test_every_handler_of_a_request_reads_the_value_of_the_choice(self) -> None:
        # HY-62: the selection runs once per request, and its value reaches the shared handler, the loaders and the
        # action of the request, whether the selection chose the request or not.
        selections = []
        seen = []

        def selects(request: Request) -> Choice:
            selections.append(request.header("Host"))
            return Choice(
                request.header("Host") == "client.test",
                {"host": request.header("Host")},
            )

        def shared(request: Request) -> dict:
            seen.append(("shared", request.selection()))
            return {}

        def side(request: Request) -> dict:
            seen.append(("side", request.selection()))
            return {"count": 0, "note": None}

        def item_load(request: Request) -> dict:
            seen.append(("item", request.selection()))
            return {"id": request.param("id")}

        def add(request: Request) -> Result:
            seen.append(("add", request.selection()))
            return Result.redirect("/")

        application = App.open(
            manifest=str(FIXTURES / "app.json"),
            program=str(PROGRAM),
            handlers={
                "shared": shared,
                "regions": {"side": side},
                "routes": {"item": {"load": item_load}, "add": {"post": add}},
            },
            timezone="+09:00",
            client_rendering=ClientRendering(str(SHELL), "/_props", selects),
        )
        application.handle(
            Request("GET", "/items/7", {"Host": "server.test"}), ArraySession()
        )
        self.assertEqual(["server.test"], selections)
        self.assertEqual(
            [
                ("shared", {"host": "server.test"}),
                ("side", {"host": "server.test"}),
                ("item", {"host": "server.test"}),
            ],
            seen,
        )
        seen.clear()
        application.handle(
            Request(
                "GET",
                "/_props/items/7",
                {"Host": "client.test", "Accept": "application/vnd.hyper+json"},
            ),
            ArraySession(),
        )
        self.assertEqual(["server.test", "client.test"], selections)
        self.assertEqual(
            [
                ("shared", {"host": "client.test"}),
                ("side", {"host": "client.test"}),
                ("item", {"host": "client.test"}),
            ],
            seen,
        )

    def test_a_selection_that_fails_answers_500(self) -> None:
        # HY-43, HY-62
        for selects in (
            lambda request: "csr",
            lambda request: True,
            lambda request: (_ for _ in ()).throw(RuntimeError("selection")),
        ):
            with self.subTest(selects):
                application = app(
                    Counter(), ClientRendering(str(SHELL), "/_props", selects)
                )
                response = application.handle(Request("GET", "/"), ArraySession())
                self.assertEqual(500, response.status)
                self.assertEqual("Internal Server Error", response.body)

    def test_an_invalid_declaration_fails_when_the_application_opens(self) -> None:
        # HY-62
        selects = lambda request: Choice(True, None)  # noqa: E731 - the declaration takes its selector as a value
        invalid = [
            (
                "relative shell",
                ClientRendering("tests/fixtures/shell/index.html", "/_props", selects),
            ),
            (
                "missing shell",
                ClientRendering(
                    str(FIXTURES / "shell" / "missing.html"), "/_props", selects
                ),
            ),
            (
                "shell of another base path",
                ClientRendering(
                    str(FIXTURES / "shell" / "other-base.html"), "/_props", selects
                ),
            ),
            ("empty base path", ClientRendering(str(SHELL), "", selects)),
            (
                "base path ending with /",
                ClientRendering(str(SHELL), "/_props/", selects),
            ),
            (
                "route under the base path",
                ClientRendering(str(SHELL), "/items", selects),
            ),
        ]
        for label, client in invalid:
            with self.subTest(label):
                with self.assertRaises(ValueError):
                    app(Counter(), client)


if __name__ == "__main__":
    unittest.main()
