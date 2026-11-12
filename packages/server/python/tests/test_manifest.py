# The regions of a route that the manifest gives (HY-37). The cases of contracts/manifest.json state the manifest
# files that the check rejects and what a manifest gives.
import json
import tempfile
import unittest
from pathlib import Path

from polyspec.hyper._manifest import Manifest


def manifest(content: object) -> Manifest:
    """Reads a manifest from a value, as a file holds it; the file is removed after the read."""
    with tempfile.TemporaryDirectory() as directory:
        file = Path(directory) / "app.json"
        file.write_text(json.dumps(content), encoding="utf-8")
        return Manifest.from_file(str(file))


BASE = {
    "layout": "layout.tpl",
    "title": "title.tpl",
    "regions": [{"name": "content", "page": True}],
    "routes": [{"name": "home", "path": "/", "title": "Home", "template": "page.tpl"}],
}


class ManifestTest(unittest.TestCase):
    def test_a_route_region_without_keep_opens(self) -> None:
        # HY-37: a route region may declare kept paths, so a route region without `keep` declares none and opens.
        declared = manifest(
            {
                **BASE,
                "routes": [
                    {
                        "name": "list",
                        "path": "/list",
                        "title": "List",
                        "template": "list.tpl",
                        "regions": [{"name": "rows", "template": "rows.tpl"}],
                    }
                ],
            }
        )
        self.assertEqual(
            ["rows"], [region.name for region in declared.routes["list"]["regions"]]
        )


if __name__ == "__main__":
    unittest.main()
