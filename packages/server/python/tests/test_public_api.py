# The modules that do not start with an underscore are the public API that HY-106 names; the package exports its classes.
import unittest
from pathlib import Path

import polyspec.hyper

PUBLIC_MODULES = [
    "app",
    "array_session",  # The session store in memory.
    "asgi",
    "bad_request",  # HY-58: the stop of a bad request.
    "choice",  # HY-62: the result of the selection of a client rendering.
    "client_rendering",
    "container",
    "file_sessions",
    "forbidden",  # HY-51: the stop of a forbidden request.
    "media_type",  # HY-106: the media type that a representation handler receives.
    "not_found",  # HY-27: the stop of a missing resource.
    "redirect",  # HY-50: the stop with a redirect.
    "redis_sessions",
    "reply",
    "representation",  # HY-106, HY-122: the response of a representation handler.
    "request",
    "response",
    "result",
    "server",
    "session_record",
    "session_store",  # HY-104: the interface of a session store.
    "uploaded_file",  # HY-113: the uploaded file class belongs to the public API.
    "wsgi",
]


class PublicApiTest(unittest.TestCase):
    def test_the_modules_without_an_underscore_and_the_package_exports_are_the_public_api(
        self,
    ) -> None:
        folder = Path(polyspec.hyper.__file__).parent
        found = sorted(
            file.stem for file in folder.glob("*.py") if not file.stem.startswith("_")
        )
        self.assertEqual(PUBLIC_MODULES, found)
        self.assertEqual(
            [
                "ArraySession",
                "BadRequest",
                "Choice",
                "ClientRendering",
                "Container",
                "Forbidden",
                "MediaType",
                "NotFound",
                "Redirect",
                "Reply",
                "Representation",
                "Request",
                "Response",
                "Result",
                "SessionStore",
                "UploadedFile",
            ],
            sorted(polyspec.hyper.__all__),
        )
