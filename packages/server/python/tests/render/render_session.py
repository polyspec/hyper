# The session of a request (HY-120): the application opens the session only for the keep path and for a request that
# selects text/html or application/vnd.hyper+json, after the checks that refuse the request. Each refusal below reaches
# the session store with no call and sets no cookie. A page request reaches the store, which proves that the counting
# store counts.
import unittest

from polyspec.hyper.app import App
from polyspec.hyper.request import Request
from polyspec.hyper.result import Result

from .render_client import Counter, app
from .render_functions import program_of


class CountingStore:
    """A session store that records every call of its interface (HY-104)."""

    def __init__(self):
        self.calls: list[str] = []
        self.values: dict = {}

    def get(self, key: str) -> object:
        self.calls.append(f"get:{key}")
        return self.values.get(key)

    def set(self, key: str, value: object) -> None:
        self.calls.append(f"set:{key}")
        self.values[key] = value

    def remove(self, key: str) -> None:
        self.calls.append(f"remove:{key}")
        self.values.pop(key, None)

    def renew(self) -> None:
        self.calls.append("renew")


def with_context_app() -> App:
    """The application with_context of var/contract-programs, with a context handler and post actions."""
    manifest, program = program_of("with_context")
    action = lambda request: Result.redirect("/")  # noqa: E731 - a stop that the refusals never reach
    return App.open(
        manifest=str(manifest),
        program=str(program),
        handlers={"routes": {"write": {"post": action}, "leave": {"post": action}}},
        timezone="+09:00",
        context=lambda selection: {"title": "Board"},
    )


class SessionTest(unittest.TestCase):
    def assertRefused(self, application: App, request: Request, status: int) -> None:
        store = CountingStore()
        response = application.handle(request, store)
        self.assertEqual(status, response.status)
        self.assertEqual([], store.calls)
        self.assertNotIn("Set-Cookie", response.headers)

    def test_a_request_that_selects_no_type_opens_no_session(self) -> None:
        # HY-116, HY-62 step 2: no served type matches the Accept header, so the answer is 406.
        self.assertRefused(
            app(Counter()),
            Request("GET", "/", {"Host": "server.test", "Accept": "image/png"}),
            406,
        )

    def test_a_put_of_a_page_route_opens_no_session(self) -> None:
        # HY-62 step 3: a method other than GET, and a POST of a route without a declared POST, give 405 before the
        # session is opened.
        self.assertRefused(
            app(Counter()),
            Request("PUT", "/", {"Host": "server.test", "Accept": "text/html"}),
            405,
        )

    def test_an_invalid_hyper_context_opens_no_session(self) -> None:
        # HY-127: an application with a context answers 400 for an invalid Hyper-Context header, after the method check.
        self.assertRefused(
            with_context_app(),
            Request(
                "GET",
                "/",
                {"Accept": "text/html", "Hyper-Context": "not-a-hash"},
            ),
            400,
        )

    def test_a_body_above_the_limit_opens_no_session(self) -> None:
        # HY-59: a body above the body limit answers 413 before any other check.
        self.assertRefused(
            app(Counter(), body_limit=8),
            Request(
                "POST",
                "/add",
                {"Host": "server.test", "Content-Type": "application/x-www-form-urlencoded"},
                "",
                b"name=" + b"x" * 64,
            ),
            413,
        )

    def test_a_page_request_under_the_data_base_path_that_selects_no_json_opens_no_session(self) -> None:
        # HY-62 step 2: under the data base path only the JSON type is served, so a text/html request gives 406.
        self.assertRefused(
            app(Counter()),
            Request("GET", "/_props/", {"Host": "client.test", "Accept": "text/html"}),
            406,
        )

    def test_a_request_that_receives_the_shell_opens_no_session(self) -> None:
        # HY-62 step 2: a page request outside the data base path of a client rendering receives the shell.
        store = CountingStore()
        response = app(Counter()).handle(
            Request("GET", "/", {"Host": "client.test", "Accept": "text/html"}), store
        )
        self.assertEqual(200, response.status)
        self.assertEqual([], store.calls)
        self.assertNotIn("Set-Cookie", response.headers)

    def test_a_page_request_that_selects_text_html_opens_the_session(self) -> None:
        # The control: a page request reaches the store, so the counting store counts the calls of a session.
        store = CountingStore()
        response = app(Counter()).handle(
            Request("GET", "/", {"Host": "server.test", "Accept": "text/html"}), store
        )
        self.assertEqual(200, response.status)
        self.assertTrue(store.calls)


if __name__ == "__main__":
    unittest.main()
