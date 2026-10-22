# The client rendering beyond the cases of contracts/client.json (HY-62): the selection, the declaration and the fixtures that
# the cases run against.
import json
import unittest
from pathlib import Path

from .fixture_app import FIXTURES, PROGRAM
from polyspec.hyper.app import App
from polyspec.hyper.client import Choice, ClientRendering
from polyspec.hyper.request import Request
from polyspec.hyper.result import Result
from polyspec.hyper.session import ArraySession

SHELL = FIXTURES / "shell" / "index.html"
CONTRACTS = Path(__file__).resolve().parents[5] / "contracts"
# A session token of HY-24; the form carries a masked value of it.
TOKEN = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"


class Counter:
    """A service that the fixture application reads and changes."""

    def __init__(self):
        self.count = 0
        self.actions = 0


def conformance() -> dict:
    return json.loads((CONTRACTS / "client.json").read_text(encoding="utf-8"))


def _handlers() -> dict:
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

    return {
        "regions": {"side": side},
        "routes": {
            "home": {"load": home_load},
            "add": {"post": add},
            "list": {"regions": {"rows": rows}},
            "item": {"load": lambda request: {"id": request.param("id")}},
        },
    }


def app(counter: Counter, client: ClientRendering | None = None, **options) -> App:
    fixture = conformance()
    if client is None:
        client = ClientRendering(
            str(SHELL),
            fixture["basePath"],
            lambda request: Choice(
                request.header("Host") == fixture["chosenHost"], None
            ),
        )
    application = App.open(
        manifest=str(FIXTURES / "app.json"),
        program=str(PROGRAM),
        handlers=_handlers(),
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
                {"Host": "client.test", "Accept": "application/json"},
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
