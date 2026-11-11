# The representations of a route (HY-116 to HY-123): every case of contracts/representations.json opens the application
# representations of var/contract-programs with a representation handler for each declared entry, sends the request and
# compares the response, the handler calls and the session with the contract. The manifest rejections and the open
# rejections open the application with the manifest or the handler map that the contract states, and the open fails.
import json
import tempfile
import unittest
from pathlib import Path

from polyspec.hyper.app import App

from .render_functions import program_of

ROOT = Path(__file__).resolve().parents[5]
CONTRACT = json.loads((ROOT / "contracts" / "representations.json").read_text(encoding="utf-8"))
APPLICATION = CONTRACT["applications"]["representations"]


def declared_types() -> dict:
    """Returns the types that each route of the application declares, in the order of the manifest."""
    return {
        route["name"]: [entry["type"] for entry in route.get("representations", [])]
        for route in APPLICATION["manifest"]["routes"]
    }


def representation_handler():
    """Returns a representation handler for an entry that the open of a rejection case never calls."""

    def handler(request, media):
        raise AssertionError("a representation handler of a rejection case is called")

    return handler


def handler_map(types: dict) -> dict:
    """Returns the handlers of the routes: a representation handler for each type of `types`, and the loaders of the
    page routes, which the application of a rejection case never runs."""
    routes = {
        name: {"representations": {entry_type: representation_handler() for entry_type in entry_types}}
        for name, entry_types in types.items()
    }
    return {"routes": routes}


class RepresentationRejectionTest(unittest.TestCase):
    pass


def _manifest_case(case: dict):
    def test(self: RepresentationRejectionTest) -> None:
        manifest = json.loads(json.dumps(APPLICATION["manifest"]))
        for route in manifest["routes"]:
            if route["name"] == case["route"]:
                route["representations"] = case["representations"]
        types = declared_types()
        types[case["route"]] = [entry["type"] for entry in case["representations"]]
        manifest_path, program = program_of("representations")
        with tempfile.TemporaryDirectory() as directory:
            written = Path(directory) / "manifest.json"
            written.write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaises(ValueError):
                App.open(
                    manifest=str(written),
                    program=str(program),
                    handlers=handler_map(types),
                    timezone="+09:00",
                )

    return test


def _open_case(case: dict):
    def test(self: RepresentationRejectionTest) -> None:
        types = declared_types()
        types[case["route"]] = case["handlers"]
        manifest_path, program = program_of("representations")
        with self.assertRaises(ValueError):
            App.open(
                manifest=str(manifest_path),
                program=str(program),
                handlers=handler_map(types),
                timezone="+09:00",
            )

    return test


for _case in CONTRACT["manifestRejections"]:
    setattr(RepresentationRejectionTest, f"test_manifest_{_case['id']}", _manifest_case(_case))

for _case in CONTRACT["openRejections"]:
    setattr(RepresentationRejectionTest, f"test_open_{_case['id']}", _open_case(_case))


if __name__ == "__main__":
    unittest.main()
