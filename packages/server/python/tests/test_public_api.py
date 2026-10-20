# The modules that do not start with an underscore are the public API that HY-106 names; the package exports its classes.
import unittest
from pathlib import Path

import polyspec.hyper

PUBLIC_MODULES = [
    "app",
    "asgi",
    "client",
    "container",
    "file_sessions",
    "reply",
    "request",
    "response",
    "result",
    "server",
    "session",
    "wsgi",
]


class PublicApiTest(unittest.TestCase):
    def test_the_modules_without_an_underscore_and_the_package_exports_are_the_public_api(
        self,
    ) -> None:
        folder = Path(polyspec.hyper.__file__).parent
        found = sorted(
            file.stem
            for file in folder.glob("*.py")
            if not file.stem.startswith("_")
        )
        self.assertEqual(PUBLIC_MODULES, found)
        self.assertEqual(
            [
                "ArraySession",
                "BadRequest",
                "Container",
                "Forbidden",
                "NotFound",
                "Redirect",
                "Reply",
                "Request",
                "Response",
                "Result",
                "SessionStore",
            ],
            sorted(polyspec.hyper.__all__),
        )
