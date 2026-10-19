# Router matching of the rest cases of contracts/rest.json (HY-49): a rest parameter takes the rest of the path. The
# PHP and the JavaScript router pass the same cases. Each case is a test method test_<id> that the parity check reads
# by its id (S6).
import json
import unittest
from pathlib import Path

from polyspec.hyper.router import Router

CONTRACTS = Path(__file__).resolve().parents[4] / "contracts"


def file(name: str) -> dict:
    return json.loads((CONTRACTS / name).read_text(encoding="utf-8"))


class RestTest(unittest.TestCase):
    def test_every_invalid_path_fails(self) -> None:
        for path in file("rest.json")["invalidPaths"]:
            with self.subTest(path):
                with self.assertRaises(ValueError):
                    Router([{"name": "x", "path": path}])


def add_cases(test_class, cases, check):
    """Adds the test method test_<id> of each case, which runs check(self, case) for it (S6)."""
    for case in cases:

        def test(self, case=case):
            check(self, case)

        setattr(test_class, f"test_{case['id']}", test)


add_cases(
    RestTest,
    file("rest.json")["cases"],
    lambda self, case: self.assertEqual(
        case["result"], Router(file("rest.json")["routes"]).match(case["path"])
    ),
)


if __name__ == "__main__":
    unittest.main()
