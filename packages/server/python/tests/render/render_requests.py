# The cases of packages/server/php/tests/AppTest.php and packages/server/ts/tests/app.test.ts against the fixture
# application of fixture_handlers.py: documents, region requests, actions, failures and the limits of the server
# (HY-3, HY-10 to HY-15, HY-18, HY-19, HY-25 to HY-27, HY-30, HY-31, HY-50 to HY-53, HY-58, HY-59, HY-65, HY-66, HY-69,
# HY-75, HY-92, HY-103).
import contextlib
import io
import json
import re
import unittest
import warnings
from urllib.parse import urlencode

from polyspec.hyper.app import App
from polyspec.hyper.csrf import verify
from polyspec.hyper.reply import Reply
from polyspec.hyper.request import Request
from polyspec.hyper.response import Response
from polyspec.hyper.result import Result
from polyspec.hyper.session import ArraySession

from .fixture_app import FIXTURES, PROGRAM
from .fixture_handlers import Counter, fixture_app, handlers

JSON = {"Accept": "application/json", "HX-Request": "true"}
FORM = {"Content-Type": "application/x-www-form-urlencoded"}
ROWS = {
    "items": ["a<", "b0"],
    "open": False,
    "mode": "a",
    "view": "x",
    "filter": {"a": 1},
    "tags": [],
}


class FixtureTest(unittest.TestCase):
    """A test with one session and one counter, as the PHP AppTest sets them up."""

    def setUp(self) -> None:
        self.session = ArraySession()
        self.counter = Counter()

    def app(self, base_path: str = "", **options) -> App:
        return fixture_app(self.counter, base_path, **options)

    def get(
        self, path: str, headers: dict | None = None, base_path: str = ""
    ) -> Response:
        return self.app(base_path).handle(
            Request("GET", path, headers or {}), self.session
        )

    def post(
        self,
        path: str,
        form: dict,
        headers: dict | None = None,
        base_path: str = "",
    ) -> Response:
        return self.app(base_path).handle(
            Request(
                "POST",
                path,
                {**FORM, **(headers or {})},
                "",
                urlencode(form).encode(),
            ),
            self.session,
        )

    def send(
        self, method: str, path: str, headers: dict, body: bytes, **options
    ) -> Response:
        return self.app("", **options).handle(
            Request(method, path, headers, "", body), self.session
        )

    def token(self) -> str:
        """The masked token of a page response (HY-24). The route region of /list keeps a value on the server, so its
        shared data keeps csrf (HY-73)."""
        return self.body(self.get("/list", JSON))["shared"]["csrf"]

    @staticmethod
    def body(response: Response) -> dict:
        return json.loads(response.body)

    def session_token(self) -> str:
        token = self.session.get("_hyper_csrf")
        self.assertIsInstance(token, str)
        return token

    def unmasked(self, body: str) -> str:
        """The body with every masked value of the session token replaced by `masked`, after it checks that each one
        verifies, so two responses of one session compare equal although their masks differ (HY-24)."""
        token = self.session_token()

        def replace(found: re.Match) -> str:
            self.assertTrue(verify(token, found[0]), found[0])
            return "masked"

        return re.sub(r"[0-9a-f]{128}", replace, body)


class DocumentTest(FixtureTest):
    def test_an_html_request_renders_the_document(self) -> None:
        # HY-3, HY-12, HY-15, HY-31: the layout places the title, the data and the regions; a route without route
        # regions embeds no data.
        response = self.get("/")
        self.assertEqual(200, response.status)
        self.assertEqual("text/html; charset=utf-8", response.headers["Content-Type"])
        self.assertEqual(
            '<title>Home - Site</title>\n<aside id="side"><b>0</b>\n</aside>\n'
            '<main id="content"><p>Home|n0</p>\n</main>\n',
            response.body,
        )

    def test_a_region_rendered_alone_matches_its_part_of_the_document(self) -> None:
        # HY-13
        from polyspec.hyper.renderer import Renderer

        renderer = Renderer.open(str(PROGRAM), "+09:00")
        shared = renderer.bind({"title": "T", "name": "shared"})
        side = renderer.bind({"count": 1, "note": "x"})
        content = renderer.bind({"title": "region", "name": "n"})
        document = renderer.document(
            "layout.tpl",
            "title.tpl",
            shared,
            {
                "side": {"template": "side.tpl", "data": side},
                "content": {"template": "page.tpl", "data": content},
            },
            "content",
            {},
            renderer.bind({"response": {}}),
        )
        self.assertIn(
            "<title>"
            + renderer.alone("title.tpl", shared, renderer.bind({}))
            + "</title>",
            document,
        )
        self.assertIn(
            '<aside id="side">' + renderer.alone("side.tpl", shared, side) + "</aside>",
            document,
        )
        self.assertEqual(
            "<p>region|n</p>\n", renderer.alone("page.tpl", shared, content)
        )
        self.assertIn('<main id="content"><p>region|n</p>\n</main>', document)

    def test_the_shared_data_starts_with_the_title_and_the_token(self) -> None:
        # HY-10, HY-14: every JSON response carries the time zone of the environment.
        answered = self.body(self.get("/list", JSON))
        self.assertEqual(["title", "csrf"], list(answered["shared"]))
        self.assertEqual("List", answered["shared"]["title"])
        self.assertEqual({"timezone": "+09:00"}, answered["env"])
        self.assertEqual(
            {"timezone": "+09:00"}, self.body(self.get("/items/7", JSON))["env"]
        )

    def test_a_region_request_returns_the_protocol_shape(self) -> None:
        # HY-17, HY-18, HY-73: no template of the route reads csrf and no route region keeps a value on the server.
        response = self.get("/items/a%20b", JSON)
        self.assertEqual(200, response.status)
        self.assertEqual(
            "application/json; charset=utf-8", response.headers["Content-Type"]
        )
        self.assertEqual(
            '{"env":{"timezone":"+09:00"},"route":"item","params":{"id":"a b"},"shared":{"title":"Item"},'
            '"regions":{"content":{"id":"a b"}},"kept":{}}',
            response.body,
        )

    def test_a_document_request_returns_every_region_in_manifest_order(self) -> None:
        # HY-15, HY-18
        answered = self.body(self.get("/", {"Accept": "application/json"}))
        self.assertEqual("home", answered["route"])
        self.assertEqual(["side", "content"], list(answered["regions"]))

    def test_an_htmx_request_is_a_region_request(self) -> None:
        # HY-15, HY-18: htmx sends HX-Request; a JSON request without it receives every region.
        self.assertEqual(["content"], list(self.body(self.get("/", JSON))["regions"]))
        self.assertEqual(
            ["side", "content"],
            list(self.body(self.get("/", {"Accept": "application/json"}))["regions"]),
        )
        self.assertEqual(
            "Accept, HX-Request, HX-Current-URL", self.get("/", JSON).headers["Vary"]
        )

    def test_a_navigation_adds_the_regions_that_use_path(self) -> None:
        # HY-11, HY-19
        same = self.body(
            self.get("/", {**JSON, "HX-Current-URL": "http://localhost/?page=2"})
        )
        other = self.body(
            self.get("/", {**JSON, "HX-Current-URL": "http://localhost/add"})
        )
        self.assertEqual(["content"], list(same["regions"]))
        self.assertEqual(["content", "side"], list(other["regions"]))
        self.assertEqual({"count": 0, "note": None}, other["regions"]["side"])

    def test_the_route_regions_follow_the_page_region(self) -> None:
        # HY-30
        region = self.body(self.get("/list", JSON))
        document = self.body(self.get("/list", {"Accept": "application/json"}))
        self.assertEqual(["content", "rows"], list(region["regions"]))
        self.assertEqual(["side", "content", "rows"], list(document["regions"]))
        self.assertEqual(ROWS, region["regions"]["rows"])
        self.assertIn(
            '<ul id="rows"><li>a&lt;</li><li>b0</li></ul>', self.get("/list").body
        )

    def test_the_page_region_alone_passes_its_route_regions_as_definitions(
        self,
    ) -> None:
        # HY-13, HY-30
        from polyspec.hyper.renderer import Renderer

        renderer = Renderer.open(str(PROGRAM), "Z")
        shared = renderer.bind({"title": "T"})
        rows = {"template": "rows.tpl", "data": renderer.bind({"items": ["x"]})}
        page = renderer.alone("list.tpl", shared, renderer.bind({}), {"rows": rows})
        document = renderer.document(
            "layout.tpl",
            "title.tpl",
            shared,
            {
                "side": {
                    "template": "side.tpl",
                    "data": renderer.bind({"count": 1}),
                },
                "content": {"template": "list.tpl", "data": renderer.bind({})},
            },
            "content",
            {"rows": rows},
            renderer.bind({"response": {}}),
        )
        self.assertEqual('<h1>T</h1><ul id="rows"><li>x</li></ul>\n', page)
        self.assertIn('<main id="content">' + page + "</main>", document)

    def test_a_route_region_loader_must_be_declared(self) -> None:
        # HY-30
        with self.assertRaises(ValueError):
            App.open(
                manifest=str(FIXTURES / "app.json"),
                program=str(PROGRAM),
                handlers={
                    "routes": {
                        "add": {"post": lambda: Result.redirect("/")},
                        "home": {"regions": {"rows": lambda: {}}},
                    }
                },
                timezone="Z",
            )

    def test_a_document_embeds_no_data_unless_the_reply_asks_for_it(self) -> None:
        # HY-31, HY-92: the JSON response is the same.
        document = self.get("/list").body
        self.assertIn('<ul id="rows"><li>a&lt;</li><li>b0</li></ul>', document)
        self.assertNotIn('id="hy-data"', document)
        embedded = self.app().handle(
            Request("GET", "/list", {}, "embed=1"), self.session
        )
        self.assertIn('id="hy-data"', embedded.body)
        plain = self.app().handle(
            Request("GET", "/list", {"Accept": "application/json"}), self.session
        )
        asked = self.app().handle(
            Request("GET", "/list", {"Accept": "application/json"}, "embed=1"),
            self.session,
        )
        self.assertEqual(self.unmasked(plain.body), self.unmasked(asked.body))

    def test_the_document_embeds_the_route_regions_of_the_document_json(self) -> None:
        # HY-31: the embedded value is the document JSON response of the same request with only the route regions and
        # their kept entries.
        cookies = {"hy-keep": '{"rows":{"mode":"b"}}'}
        html = (
            self.app()
            .handle(
                Request("GET", "/list", {}, "embed=1", cookies=cookies), self.session
            )
            .body
        )
        answered = self.body(
            self.app().handle(
                Request(
                    "GET", "/list", {"Accept": "application/json"}, cookies=cookies
                ),
                self.session,
            )
        )
        match = re.search(r'id="hy-data">(.*?)</script>', html, re.S)
        self.assertIsNotNone(match)
        embedded = json.loads(match[1])
        self.assertEqual(["rows"], list(embedded["regions"]))
        self.assertEqual(answered["regions"]["rows"], embedded["regions"]["rows"])
        self.assertEqual(answered["kept"], embedded["kept"])

    def test_a_route_region_whose_loader_returns_none_is_absent(self) -> None:
        # HY-75: no data, no kept entry and no definition; the page renders without the element and without #hy-data.
        def rows(request: Request, reply: Reply) -> dict | None:
            reply.embed_data()
            if request.query_int("rows", 1) == 0:
                return None
            return {**ROWS, "items": ["a"]}

        loaded = handlers()
        loaded["routes"]["list"]["regions"]["rows"] = rows
        app = self.app(handlers=loaded)
        cookies = {"hy-keep": '{"rows":{"mode":"b"}}'}
        answered = self.body(
            app.handle(
                Request(
                    "GET",
                    "/list",
                    {"Accept": "application/json"},
                    "rows=0",
                    cookies=cookies,
                ),
                self.session,
            )
        )
        self.assertEqual(["side", "content"], list(answered["regions"]))
        self.assertEqual({}, answered["kept"])
        document = app.handle(
            Request("GET", "/list", {}, "rows=0", cookies=cookies), self.session
        ).body
        self.assertIn('<main id="content"><h1>List</h1>\n</main>', document)
        self.assertNotIn('id="rows"', document)
        self.assertNotIn('id="hy-data"', document)
        present = app.handle(
            Request("GET", "/list", {}, "rows=1", cookies=cookies), self.session
        ).body
        self.assertIn('<ul id="rows"><li>a</li></ul>', present)
        self.assertIn('id="hy-data"', present)


class ActionTest(FixtureTest):
    def test_a_successful_action_redirects_and_passes_flash_and_topics_once(
        self,
    ) -> None:
        # HY-25
        response = self.post("/add", {"_csrf": self.token(), "name": "a"}, JSON)
        self.assertEqual(303, response.status)
        self.assertEqual("/", response.headers["Location"])
        following = self.body(self.get("/", JSON))
        self.assertEqual(["content", "side"], list(following["regions"]))
        self.assertEqual({"count": 1, "note": "added"}, following["regions"]["side"])
        self.assertEqual({"name": "n1"}, following["regions"]["content"])
        after = self.body(self.get("/", JSON))
        self.assertEqual(["content"], list(after["regions"]))

    def test_a_rejected_action_renders_the_page_with_status_422(self) -> None:
        # HY-26
        token = self.token()
        as_json = self.post("/add", {"_csrf": token, "name": ""}, JSON)
        as_html = self.post("/add", {"_csrf": token, "name": ""})
        self.assertEqual(422, as_json.status)
        self.assertEqual(
            {"name": "", "error": "empty"}, self.body(as_json)["regions"]["content"]
        )
        self.assertEqual(422, as_html.status)
        self.assertIn("<p>Add| !empty</p>", as_html.body)
        self.assertEqual(0, self.counter.count)

    def test_unknown_paths_missing_resources_and_methods_fail(self) -> None:
        # HY-27
        self.assertEqual(404, self.get("/missing").status)
        self.assertEqual(404, self.get("/items/missing").status)
        self.assertEqual(405, self.post("/", {}).status)
        self.assertEqual(
            405,
            self.app().handle(Request("DELETE", "/add"), self.session).status,
        )

    def test_a_loader_redirect_answers_with_303_and_passes_flash(self) -> None:
        # HY-50
        response = self.get("/items/moved", JSON)
        self.assertEqual(303, response.status)
        self.assertEqual("/items/new", response.headers["Location"])
        self.assertEqual("", response.body)
        following = self.body(self.get("/", {"Accept": "application/json"}))
        self.assertEqual("moved", following["regions"]["side"]["note"])
        self.assertEqual(
            "/api/items/new",
            self.get("/api/items/moved", base_path="/api").headers["Location"],
        )

    def test_a_forbidden_loader_and_action_answer_with_403(self) -> None:
        # HY-51
        page = self.get("/items/private")
        self.assertEqual(403, page.status)
        self.assertEqual("Forbidden", page.body)
        action = self.post("/add", {"_csrf": self.token(), "name": "closed"})
        self.assertEqual(403, action.status)
        self.assertEqual(0, self.counter.count)

    def test_a_bad_request_loader_and_action_answer_with_400(self) -> None:
        # HY-58
        page = self.get("/items/unreadable", JSON)
        self.assertEqual(400, page.status)
        self.assertEqual("Bad Request", page.body)
        self.assertEqual("text/plain; charset=utf-8", page.headers["Content-Type"])
        action = self.post("/add", {"_csrf": self.token(), "name": "unreadable"})
        self.assertEqual(400, action.status)
        self.assertEqual(0, self.counter.count)

    def test_an_action_result_renders_the_page_with_its_status(self) -> None:
        # HY-58: with 200, 409 or 422 and its data, as JSON or as a document; HY-53: only a GET receives 304.
        token = self.token()
        taken = self.post("/add", {"_csrf": token, "name": "taken"}, JSON)
        self.assertEqual(409, taken.status)
        self.assertEqual(
            {"name": "taken", "error": "conflict"},
            self.body(taken)["regions"]["content"],
        )
        preview = self.post("/add", {"_csrf": token, "name": "preview"})
        self.assertEqual(200, preview.status)
        self.assertIn("preview", preview.body)
        for status in (201, 303, 400, 404, 500):
            with self.assertRaises(ValueError):
                Result.page(status, {})
        self.assertEqual(422, Result.invalid({}).status)

    def test_a_reply_gives_the_page_the_status_403(self) -> None:
        # HY-69: the page renders as with 200 and has the status 403, no-store and no ETag.
        page = self.get("/items/in-place")
        self.assertEqual(403, page.status)
        self.assertEqual("no-store", page.headers["Cache-Control"])
        self.assertIn("in-place", page.body)
        as_json = self.get("/items/in-place", JSON)
        self.assertEqual(403, as_json.status)
        self.assertNotIn("ETag", as_json.headers)
        moved = self.get("/items/in-place-moved")
        self.assertEqual(303, moved.status)
        self.assertEqual(500, self.get("/items/other-status").status)
        action = self.post("/add", {"_csrf": self.token(), "name": "in-place"})
        self.assertEqual(403, action.status)

    def test_the_reply_cookies_and_cache_control_reach_the_response(self) -> None:
        # HY-52
        page = self.get("/items/member")
        self.assertEqual(200, page.status)
        self.assertEqual(
            [
                "member=token.1; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600",
                "old=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
            ],
            page.headers["Set-Cookie"],
        )
        self.assertEqual("private, max-age=60", page.headers["Cache-Control"])
        forbidden = self.get("/items/guarded")
        self.assertEqual(403, forbidden.status)
        self.assertEqual(
            ["member=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"],
            forbidden.headers["Set-Cookie"],
        )
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(500, self.get("/items/bad-cookie").status)
        self.assertNotIn("Set-Cookie", self.get("/items/plain").headers)

    def test_a_page_is_not_stored_unless_the_reply_sets_cache_control(self) -> None:
        # HY-52: documents and JSON have no-store by default, and only a page with status 200 takes the reply value.
        self.assertEqual("no-store", self.get("/items/plain").headers["Cache-Control"])
        self.assertEqual(
            "no-store", self.get("/items/plain", JSON).headers["Cache-Control"]
        )
        self.assertEqual(
            "private, max-age=60",
            self.get("/items/member", JSON).headers["Cache-Control"],
        )

    def test_the_referrer_policy_of_the_reply_reaches_every_page_and_json_answer(
        self,
    ) -> None:
        # HY-103: a page, a JSON answer, the 304 of that answer and a page with status 403 carry the value of the
        # reply; a page without a call and a plain text failure carry none.
        page = self.get("/items/referrer")
        self.assertEqual("same-origin", page.headers["Referrer-Policy"])
        as_json = self.get("/items/referrer", JSON)
        self.assertEqual("same-origin", as_json.headers["Referrer-Policy"])
        again = self.get(
            "/items/referrer", {**JSON, "If-None-Match": as_json.headers["ETag"]}
        )
        self.assertEqual(304, again.status)
        self.assertEqual("same-origin", again.headers["Referrer-Policy"])
        self.assertEqual(
            "origin",
            self.get("/items/referrer-in-place", JSON).headers["Referrer-Policy"],
        )
        self.assertNotIn("Referrer-Policy", self.get("/items/plain").headers)
        self.assertNotIn("Referrer-Policy", self.get("/items/missing").headers)

    def test_a_json_response_has_a_tag_and_a_matching_request_gets_304(self) -> None:
        # HY-53
        first = self.get("/items/plain", {"Accept": "application/json"})
        tag = first.headers["ETag"]
        again = self.get(
            "/items/plain", {"Accept": "application/json", "If-None-Match": tag}
        )
        self.assertEqual(304, again.status)
        self.assertEqual("", again.body)
        self.assertEqual(tag, again.headers["ETag"])
        self.assertNotIn("Content-Type", again.headers)
        other = self.get(
            "/items/plain",
            {"Accept": "application/json", "If-None-Match": '"other"'},
        )
        self.assertEqual(200, other.status)


class WarningTest(FixtureTest):
    def test_a_warning_of_the_runtime_fails_the_request(self) -> None:
        # HY-74, HY-43: the request fails instead of answering a wrong page with status 200, and the failure reaches the
        # response hook.
        def shared(request: Request) -> dict:
            warnings.warn("beware", RuntimeWarning, stacklevel=1)
            return {"site": "x"}

        loaded = {**handlers(), "shared": shared}
        reports: list = []
        app = self.app(
            handlers=loaded,
            on_response=lambda request, response, elapsed, reply, failure: (
                reports.append((response.status, failure))
            ),
        )
        with contextlib.redirect_stderr(io.StringIO()):
            response = app.handle(Request("GET", "/"), self.session)
        self.assertEqual(500, response.status)
        self.assertEqual("Internal Server Error", response.body)
        self.assertEqual([(500, "beware")], reports)

    def test_the_filters_of_the_process_are_restored_after_the_request(self) -> None:
        # HY-74: the server sets the filter for the requests only.
        before = list(warnings.filters)
        self.assertEqual(200, self.get("/").status)
        self.assertEqual(before, list(warnings.filters))
        with warnings.catch_warnings(record=True) as seen:
            warnings.simplefilter("always")
            warnings.warn("after", RuntimeWarning, stacklevel=1)
        self.assertEqual(1, len(seen))


class LimitTest(FixtureTest):
    def test_the_body_limit_the_media_type_and_the_token_are_checked_in_order(
        self,
    ) -> None:
        # HY-59: 413 before 415 before the CSRF check of HY-24, and no action runs.
        token = self.token()
        limit = {"body_limit": 64}
        text = {"Content-Type": "text/plain"}
        large = b"_csrf=wrong&name=" + b"a" * 48
        self.assertEqual(65, len(large))
        too_large = self.send("POST", "/add", text, large, **limit)
        self.assertEqual(413, too_large.status)
        self.assertEqual("Content Too Large", too_large.body)
        self.assertEqual(413, self.send("GET", "/", text, large, **limit).status)
        self.assertEqual(
            413, self.send("POST", "/_hyper/keep", text, large, **limit).status
        )
        self.assertEqual(
            415, self.send("POST", "/add", text, b"_csrf=wrong&name=a", **limit).status
        )
        unsupported = self.send(
            "POST",
            "/add",
            {"Content-Type": "multipart/form-data; boundary=x"},
            f'--x\r\nContent-Disposition: form-data; name="_csrf"\r\n\r\n{token}\r\n--x--\r\n'.encode(),
        )
        self.assertEqual(415, unsupported.status)
        self.assertEqual("Unsupported Media Type", unsupported.body)
        self.assertEqual(
            403,
            self.send(
                "POST", "/add", FORM, b"_csrf=wrong&name=" + b"a" * 47, **limit
            ).status,
        )
        self.assertEqual(0, self.counter.actions)
        mixed_case = {
            "Content-Type": "Application/X-WWW-Form-Urlencoded; charset=UTF-8"
        }
        self.assertEqual(
            303,
            self.send(
                "POST", "/add", mixed_case, f"_csrf={token}&name=a".encode()
            ).status,
        )

    def test_the_accepted_form_types_are_an_option(self) -> None:
        # HY-59
        token = self.token()
        body = (
            f'--x\r\nContent-Disposition: form-data; name="_csrf"\r\n\r\n{token}\r\n'
            '--x\r\nContent-Disposition: form-data; name="name"\r\n\r\na\r\n--x--\r\n'
        ).encode()
        both = ["application/x-www-form-urlencoded", "multipart/form-data"]
        self.assertEqual(
            303,
            self.send(
                "POST",
                "/add",
                {"Content-Type": "multipart/form-data; boundary=x"},
                body,
                form_types=both,
            ).status,
        )
        self.assertEqual(
            415,
            self.send(
                "POST",
                "/add",
                FORM,
                f"_csrf={token}&name=a".encode(),
                form_types=["multipart/form-data"],
            ).status,
        )
        for options in (
            {"form_types": []},
            {"form_types": ["text/plain"]},
            {"form_types": ["multipart/form-data", "multipart/form-data"]},
            {"body_limit": 0},
        ):
            with self.assertRaises(ValueError, msg=str(options)):
                self.app("", **options)

    def test_every_failure_is_not_cacheable(self) -> None:
        # HY-65: every response with a status of 400 or more has Cache-Control: no-store.
        token = self.token()
        with contextlib.redirect_stderr(io.StringIO()):
            responses = [
                self.get("/", {"HX-Current-URL": "http://x/\udcff"}),
                self.get("/items/unreadable"),
                self.get("/items/private"),
                self.post("/add", {"_csrf": "wrong", "name": "a"}),
                self.get("/missing"),
                self.get("/items/missing"),
                self.post("/", {}),
                self.send("POST", "/add", FORM, b"x" * 70, body_limit=64),
                self.send("POST", "/add", {"Content-Type": "text/plain"}, b"_csrf=x"),
                self.get("/items/broken"),
                self.post("/add", {"_csrf": token, "name": "taken"}, JSON),
                self.post("/add", {"_csrf": token, "name": ""}, JSON),
            ]
        for response in responses:
            self.assertEqual(
                "no-store",
                response.headers.get("Cache-Control"),
                str(response.status),
            )
            self.assertGreaterEqual(response.status, 400)
        self.assertEqual(
            "private, max-age=60", self.get("/items/member").headers["Cache-Control"]
        )

    def test_a_response_larger_than_the_limit_is_not_sent(self) -> None:
        # HY-66: the server logs the size, answers a plain 500 that no cache stores and reports it to the hook.
        reports: list = []
        options = {
            "response_limit": 64,
            "on_response": lambda request, response, elapsed, reply, failure: (
                reports.append((response.status, reply.notes(), failure))
            ),
        }
        log = io.StringIO()
        with contextlib.redirect_stderr(log):
            document = self.send("GET", "/", {}, b"", **options)
            as_json = self.send("GET", "/items/7", JSON, b"", **options)
            small = self.send("GET", "/", {}, b"", response_limit=1 << 20)
        for response in (document, as_json):
            self.assertEqual(500, response.status)
            self.assertEqual("Internal Server Error", response.body)
            self.assertEqual("no-store", response.headers["Cache-Control"])
            self.assertEqual(
                "text/plain; charset=utf-8", response.headers["Content-Type"]
            )
        self.assertEqual(200, small.status)
        self.assertRegex(
            log.getvalue(),
            r"hyper: the response to GET / has \d+ bytes, more than the response limit of 64 bytes",
        )
        self.assertEqual(2, len(reports))
        self.assertEqual([(500, {}), (500, {})], [r[:2] for r in reports])
        self.assertRegex(
            reports[1][2],
            r"^the response to GET /items/7 has \d+ bytes, more than the response limit of 64 bytes$",
        )
        for limit in (0, -1):
            with self.assertRaises(ValueError):
                self.app("", response_limit=limit)
