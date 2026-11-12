# The package exports the public API that HY-106 names; its directory holds no module but the barrel.
import unittest
from pathlib import Path

import polyspec.hyper


class PublicApiTest(unittest.TestCase):
    def test_the_package_holds_no_module_but_the_barrel_and_exports_the_public_api(
        self,
    ) -> None:
        folder = Path(polyspec.hyper.__file__).parent
        self.assertEqual(
            ["__init__.py"], sorted(file.name for file in folder.glob("*.py"))
        )
        self.assertEqual(
            [
                "App",
                "ArraySession",
                "BadRequest",
                "Choice",
                "ClientRendering",
                "Container",
                "FileSessions",
                "Forbidden",
                "MediaType",
                "NotFound",
                "Redirect",
                "RedisSessions",
                "Reply",
                "Representation",
                "Request",
                "Response",
                "Result",
                "SessionLockError",
                "SessionStore",
                "UploadedFile",
                "create_asgi",
                "create_server",
                "create_wsgi",
            ],
            sorted(polyspec.hyper.__all__),
        )
