# The session of a request (HY-120): an application with a context refuses an invalid Hyper-Context header before it
# opens the session, so the refusal reaches the session store with no call and sets no cookie. The cases of
# contracts/client.json state the other refusals and the calls of a request that opens the session.
import unittest

from polyspec.hyper.app import App
from polyspec.hyper.request import Request
from polyspec.hyper.result import Result

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


if __name__ == "__main__":
    unittest.main()
