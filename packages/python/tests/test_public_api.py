# The package exports the public API that HY-106 names; its directory holds no module but the barrel. The names of the
# API are the fixture tests/fixtures/public-api.json, so that the test states them once beside the barrel.
import json
import unittest
from pathlib import Path

import polyspec.hyper

_PUBLIC_API = Path(__file__).parent / "fixtures" / "public-api.json"


class PublicApiTest(unittest.TestCase):
    def test_the_package_holds_no_module_but_the_barrel_and_exports_the_public_api(
        self,
    ) -> None:
        folder = Path(polyspec.hyper.__file__).parent
        self.assertEqual(
            ["__init__.py"], sorted(file.name for file in folder.glob("*.py"))
        )
        self.assertEqual(
            json.loads(_PUBLIC_API.read_text(encoding="utf-8")),
            sorted(polyspec.hyper.__all__),
        )
