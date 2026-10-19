# Router matching of the conformance cases of contracts/routes.json (HY-4 to HY-8, HY-49). The PHP and the JavaScript
# router pass the same cases. Each case is a test method test_<id> that the parity check reads by its id (S6).
import json
import unittest
from pathlib import Path

from polyspec.hyper.router import Router, strip_base_path

CONTRACTS = Path(__file__).resolve().parents[4] / "contracts"


def file(name: str) -> dict:
    return json.loads((CONTRACTS / name).read_text(encoding="utf-8"))


def add_cases(test_class, cases, check):
    """Adds the test method test_<id> of each case, which runs check(self, case) for it (S6)."""
    for case in cases:

        def test(self, case=case):
            check(self, case)

        setattr(test_class, f"test_{case['id']}", test)


class RoutesTest(unittest.TestCase):
    def test_every_invalid_path_fails(self) -> None:
        for path in file("routes.json")["invalidPaths"]:
            with self.subTest(path):
                with self.assertRaises(ValueError):
                    Router([{"name": "x", "path": path}])


add_cases(
    RoutesTest,
    file("routes.json")["cases"],
    lambda self, case: self.assertEqual(
        case["result"], Router(file("routes.json")["routes"]).match(case["path"])
    ),
)


class BasePathRoutesTest(unittest.TestCase):
    pass


def _under_base_path(self, case) -> None:
    fixture = file("routes.json")
    path = strip_base_path(case["path"], fixture["basePath"])
    router = Router(fixture["routes"])
    self.assertEqual(case["result"], None if path is None else router.match(path))


add_cases(BasePathRoutesTest, file("routes.json")["baseCases"], _under_base_path)


if __name__ == "__main__":
    unittest.main()
