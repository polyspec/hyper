# The application answers document requests, JSON requests, region requests and actions with the rules of the PHP
# server (HY-15 to HY-19, HY-24 to HY-26, HY-40, HY-50 to HY-53, HY-58, HY-69, HY-73, HY-92).
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from urllib.parse import urlencode

from .fixture_app import FIXTURES, PROGRAM
from polyspec.hyper.app import App
from polyspec.hyper._csrf import masked
from polyspec.hyper.reply import Reply
from polyspec.hyper.request import Request
from polyspec.hyper.response import Response
from polyspec.hyper.result import Result
from polyspec.hyper.session import ArraySession

TOKEN = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"


class OrmError(Exception):
    """An error shaped like the OrmError of polyspec.orm, which hyper identifies by its class name and its code (HY-107)."""

    def __init__(self, code: str):
        super().__init__(f"{code}: a failure of the ORM")
        self.code = code


def handlers() -> dict:
    def add(request: Request) -> Result:
        if request.form_string("name") == "taken":
            return Result.page(409, {"name": "taken"})
        if request.form_string("name").startswith("orm-"):
            raise OrmError(
                {"orm-stale": "REVISION_CHANGED", "orm-missing": "NO_ROWS"}.get(
                    request.form_string("name"), "DRIVER"
                )
            )
        return Result.redirect("/list").flash_value("created", 3).changed("rows")

    def item(request: Request) -> dict:
        if request.param("id") in ("orm-missing", "orm-stale"):
            raise OrmError(
                "NO_ROWS"
                if request.param("id") == "orm-missing"
                else "REVISION_CHANGED"
            )
        return {"id": request.param("id")}

    return {
        "shared": lambda request: {"site": "fixture"},
        "regions": {"side": lambda request: {"count": 2}},
        "routes": {
            "home": {"load": lambda request: {"name": "n"}},
            "add": {"post": add},
            "item": {"load": item},
            "list": {
                "load": lambda request: {"rows": 2},
                "regions": {
                    "rows": lambda request: {
                        "posts": [{"title": "a"}],
                        "sort": "",
                        "compact": False,
                        "open": False,
                        "highlight": request.flash("created"),
                    }
                },
            },
        },
    }


def opened(**options) -> App:
    return App.open(
        manifest=str(FIXTURES / "app.json"),
        program=str(PROGRAM),
        handlers=handlers(),
        timezone="+09:00",
        **options,
    )


def opened_with(shared_loader) -> App:
    """The application whose shared handler is `shared_loader`."""
    return App.open(
        manifest=str(FIXTURES / "app.json"),
        program=str(PROGRAM),
        handlers={**handlers(), "shared": shared_loader},
        timezone="+09:00",
    )


def rows_app(tags: list) -> App:
    """The application whose region `rows` has the data of the fixtures of the PHP tests with the given `tags`."""
    loaded = handlers()

    def rows(request: Request, reply: Reply) -> dict:
        # HY-92: the query embed=1 makes the document embed its data.
        if request.query_int("embed", 0) == 1:
            reply.embed_data()
        return {
            "items": ["a<"],
            "open": False,
            "mode": "a",
            "view": "x",
            "filter": {"a": 1},
            "tags": tags,
        }

    loaded["routes"]["list"]["regions"]["rows"] = rows
    return App.open(
        manifest=str(FIXTURES / "app.json"),
        program=str(PROGRAM),
        handlers=loaded,
        timezone="+09:00",
    )


def get(
    path: str, headers: dict | None = None, query: str = "", body: bytes = b""
) -> Request:
    return Request("GET", path, headers or {}, query, body)


class PageTest(unittest.TestCase):
    def test_a_document_request_receives_the_document_html(self) -> None:
        response = opened().handle(
            get("/", {"Accept": "application/json"}), ArraySession()
        )
        self.assertEqual(200, response.status)
        self.assertEqual(
            "application/json; charset=utf-8", response.headers["Content-Type"]
        )
        answered = json.loads(response.body)
        self.assertEqual("home", answered["route"])
        self.assertEqual(["side", "content"], list(answered["regions"]))
        self.assertEqual("Home", answered["shared"]["title"])
        self.assertEqual({}, answered["kept"])

    def test_a_region_request_receives_the_page_and_the_changed_regions(self) -> None:
        store = ArraySession()
        app = opened()
        app.handle(get("/list", {"Accept": "application/json"}), store)
        # The action of the next request stores the changed topic `rows`; the region request selects the regions
        # that use it.
        app.handle(
            Request(
                "POST",
                "/add",
                {
                    "Accept": "application/json",
                    "Content-Type": "application/x-www-form-urlencoded",
                    "HX-Request": "true",
                },
                body=urlencode(
                    {"_csrf": masked(_token(app, store)), "name": "ok"}
                ).encode(),
            ),
            store,
        )
        response = app.handle(
            get(
                "/list",
                {
                    "Accept": "application/json",
                    "HX-Request": "true",
                    "HX-Current-URL": "http://host.example/list",
                },
            ),
            store,
        )
        answered = json.loads(response.body)
        self.assertEqual(["content", "rows"], list(answered["regions"]))

    def test_an_html_request_receives_a_document(self) -> None:
        response = opened().handle(get("/items/7"), ArraySession())
        self.assertEqual(200, response.status)
        self.assertEqual("text/html; charset=utf-8", response.headers["Content-Type"])
        self.assertIn("no-store", response.headers["Cache-Control"])
        self.assertIn("Item", response.body)

    def test_the_embedded_data_of_a_document_that_the_reply_asks_for(self) -> None:
        app = opened()
        seen: list[bool] = []

        def shared_loader(request: Request, reply: Reply) -> dict:
            if request.path() == "/list":
                reply.embed_data()
                seen.append(True)
            return {"site": "fixture"}

        app_with_embed = App.open(
            manifest=str(FIXTURES / "app.json"),
            program=str(PROGRAM),
            handlers={**handlers(), "shared": shared_loader},
            timezone="+09:00",
        )
        document = app_with_embed.handle(get("/list"), ArraySession()).body
        self.assertEqual([True], seen)
        self.assertIn('id="hy-data"', document)
        self.assertNotIn('id="hy-data"', app.handle(get("/list"), ArraySession()).body)

    def test_a_page_without_a_present_route_region_embeds_no_data(self) -> None:
        def shared_loader(request: Request, reply: Reply) -> dict:
            reply.embed_data()
            return {}

        app = App.open(
            manifest=str(FIXTURES / "app.json"),
            program=str(PROGRAM),
            handlers={**handlers(), "shared": shared_loader},
            timezone="+09:00",
        )
        self.assertNotIn('id="hy-data"', app.handle(get("/"), ArraySession()).body)


class ActionTest(unittest.TestCase):
    def test_an_action_that_succeeds_redirects(self) -> None:
        store = ArraySession()
        app = opened()
        response = app.handle(
            Request(
                "POST",
                "/add",
                {"Content-Type": "application/x-www-form-urlencoded"},
                body=urlencode(
                    {"_csrf": masked(_token(app, store)), "name": "ok"}
                ).encode(),
            ),
            store,
        )
        self.assertEqual(303, response.status)
        self.assertEqual("/list", response.headers["Location"])

    def test_an_action_without_a_csrf_token_is_forbidden(self) -> None:
        response = opened().handle(
            Request(
                "POST",
                "/add",
                {"Content-Type": "application/x-www-form-urlencoded"},
                body=b"name=ok",
            ),
            ArraySession(),
        )
        self.assertEqual(403, response.status)
        self.assertEqual("Forbidden", response.body)

    def test_an_action_result_page_with_status_409(self) -> None:
        store = ArraySession()
        app = opened()
        response = app.handle(
            Request(
                "POST",
                "/add",
                {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Accept": "application/json",
                },
                body=urlencode(
                    {"_csrf": masked(_token(app, store)), "name": "taken"}
                ).encode(),
            ),
            store,
        )
        self.assertEqual(409, response.status)
        answered = json.loads(response.body)
        self.assertEqual("add", answered["route"])
        self.assertEqual("taken", answered["regions"]["content"]["name"])

    def test_orm_errors_are_answered_as_their_stops(self) -> None:
        # HY-107: NO_ROWS is a not found, REVISION_CHANGED is the route page with status 409 and no data of its own.
        store = ArraySession()
        app = opened()

        def add(name: str):
            return app.handle(
                Request(
                    "POST",
                    "/add",
                    {"Content-Type": "application/x-www-form-urlencoded"},
                    body=urlencode(
                        {"_csrf": masked(_token(app, store)), "name": name}
                    ).encode(),
                ),
                store,
            )

        missing = app.handle(get("/items/orm-missing"), store)
        self.assertEqual((404, "Not Found"), (missing.status, missing.body))
        action = add("orm-missing")
        self.assertEqual((404, "Not Found"), (action.status, action.body))
        stale = add("orm-stale")
        self.assertEqual(409, stale.status)
        self.assertEqual("no-store", stale.headers["Cache-Control"])
        # A loader cannot answer with the page that it fails to load, and another code is not handled: HY-43. The server
        # logs these two on stderr, which the verbose output of unittest would interleave with its result lines.
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(500, app.handle(get("/items/orm-stale"), store).status)
            self.assertEqual(500, add("orm-other").status)

    def test_the_etag_of_a_json_page_and_the_304_of_a_matching_request(self) -> None:
        store = ArraySession()
        app = opened()
        first = app.handle(get("/list", {"Accept": "application/json"}), store)
        tag = first.headers["ETag"]
        self.assertTrue(tag.startswith('W/"'))
        again = app.handle(
            get("/list", {"Accept": "application/json", "If-None-Match": tag}), store
        )
        self.assertEqual(304, again.status)
        self.assertNotIn("Content-Type", again.headers)
        self.assertEqual("", again.body)

    def test_the_reply_gives_a_page_the_status_403(self) -> None:
        def shared_loader(request: Request, reply: Reply) -> dict:
            reply.status(403)
            return {}

        response = opened_with(shared_loader).handle(
            get("/", {"Accept": "application/json"}), ArraySession()
        )
        self.assertEqual(403, response.status)
        self.assertEqual("no-store", response.headers["Cache-Control"])


class ReferrerPolicyTest(unittest.TestCase):
    def test_the_referrer_policy_of_the_reply_reaches_every_page_and_json_answer(
        self,
    ) -> None:
        # HY-103: a document, a JSON answer and the 304 of that answer carry the value of the reply.
        def shared_loader(request: Request, reply: Reply) -> dict:
            reply.referrer_policy("strict-origin-when-cross-origin")
            return {"site": "fixture"}

        app = opened_with(shared_loader)
        store = ArraySession()
        document = app.handle(get("/"), store)
        self.assertEqual(
            "strict-origin-when-cross-origin", document.headers["Referrer-Policy"]
        )
        answer = app.handle(get("/", {"Accept": "application/json"}), store)
        self.assertEqual(
            "strict-origin-when-cross-origin", answer.headers["Referrer-Policy"]
        )
        again = app.handle(
            get(
                "/",
                {"Accept": "application/json", "If-None-Match": answer.headers["ETag"]},
            ),
            store,
        )
        self.assertEqual(304, again.status)
        self.assertEqual(
            "strict-origin-when-cross-origin", again.headers["Referrer-Policy"]
        )
        self.assertNotIn(
            "Referrer-Policy", opened().handle(get("/"), ArraySession()).headers
        )

    def test_the_referrer_policy_of_a_page_with_status_403_is_written(self) -> None:
        def shared_loader(request: Request, reply: Reply) -> dict:
            reply.status(403).referrer_policy("origin")
            return {}

        response = opened_with(shared_loader).handle(
            get("/", {"Accept": "application/json"}), ArraySession()
        )
        self.assertEqual(403, response.status)
        self.assertEqual("origin", response.headers["Referrer-Policy"])


class KeepTest(unittest.TestCase):
    def test_a_conforming_kept_value_replaces_its_path(self) -> None:
        store = ArraySession()
        store.set("_hyper_keep", {"rows": {"open": True}})
        response = opened().handle(get("/list", {"Accept": "application/json"}), store)
        answered = json.loads(response.body)
        self.assertEqual({"open": True}, answered["kept"]["rows"])
        self.assertEqual(True, answered["kept"]["rows"]["open"])

    def test_a_region_whose_kept_values_break_rendering_renders_without_them(
        self,
    ) -> None:
        # HY-38: a conforming value can still fail in the template; the document drops the kept values of that region.
        cookies = {"hy-keep": '{"rows":{"mode":"b","tags":[1]}}'}
        document = rows_app(tags=[]).handle(
            Request("GET", "/list", {}, "embed=1", cookies=cookies), ArraySession()
        )
        self.assertEqual(200, document.status)
        self.assertIn("<li>a&lt;</li>", document.body)
        self.assertIn('"kept":{}', document.body)

    def test_a_render_failure_of_the_loader_data_is_not_hidden_by_kept_values(
        self,
    ) -> None:
        # HY-38, HY-43: the loader data breaks the template itself, so dropping the kept values does not help and
        # rendering fails with the plain 500.
        cookies = {"hy-keep": '{"rows":{"mode":"b"}}'}
        response = rows_app(tags=[1]).handle(
            Request("GET", "/list", {}, "embed=1", cookies=cookies), ArraySession()
        )
        self.assertEqual(500, response.status)
        self.assertEqual("Internal Server Error", response.body)

    def test_the_keep_endpoint_stores_a_server_value(self) -> None:
        store = ArraySession()
        response = post_keep(store, {"region": "rows", "path": "open", "value": "true"})
        self.assertEqual(204, response.status)
        self.assertEqual({"open": True}, session_kept(store))

    def test_the_keep_endpoint_rejects_a_path_that_is_not_server(self) -> None:
        store = ArraySession()
        response = post_keep(store, {"region": "rows", "path": "view", "value": '"x"'})
        self.assertEqual(400, response.status)


class ProgramTest(unittest.TestCase):
    def test_a_missing_program_names_the_missing_file(self) -> None:
        # HY-48: a missing build fails when the application opens and names the missing file.
        with tempfile.TemporaryDirectory() as directory:
            empty = Path(directory)
            with self.assertRaises(ValueError) as missing:
                App.open(
                    manifest=str(FIXTURES / "app.json"),
                    program=str(empty),
                    handlers=handlers(),
                    timezone="+09:00",
                )
            self.assertIn("reads.json", str(missing.exception))
            (empty / "reads.json").write_text('{"routes": {}}', encoding="utf-8")
            with self.assertRaises(ValueError) as missing:
                App.open(
                    manifest=str(FIXTURES / "app.json"),
                    program=str(empty),
                    handlers=handlers(),
                    timezone="+09:00",
                )
            self.assertIn("templates", str(missing.exception))


def post_keep(store: ArraySession, fields: dict) -> Response:
    """Posts the form `fields` with the CSRF value of the session `store` to the keep endpoint of a new application."""
    app = opened()
    token = _token(app, store)
    return app.handle(
        Request(
            "POST",
            "/_hyper/keep",
            {"Content-Type": "application/x-www-form-urlencoded"},
            body=urlencode({"_csrf": masked(token), **fields}).encode(),
        ),
        store,
    )


def _token(app: App, store: ArraySession) -> str:
    from polyspec.hyper._session import Session

    return Session(store).csrf_token()


def session_kept(store: ArraySession) -> dict:
    from polyspec.hyper._session import Session

    return Session(store).kept("rows")


if __name__ == "__main__":
    unittest.main()
