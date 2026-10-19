# Kept values of the conformance cases (HY-37, HY-38, HY-41). The PHP and the JavaScript implementation pass the
# same cases of contracts/keep.json; the applied data is compared as JSON text, so an empty map stays a map.
import json
import unittest
from pathlib import Path

from polyspec.hyper.kept import apply, select

CONTRACTS = Path(__file__).resolve().parents[4] / "contracts"


def file(name: str) -> dict:
    return json.loads((CONTRACTS / name).read_text(encoding="utf-8"))


def cases() -> list[dict]:
    return file("keep.json")["cases"]


def add_cases(test_class, cases, check):
    """Adds the test method test_<id> of each case, which runs check(self, case) for it (S6)."""
    for case in cases:

        def test(self, case=case):
            check(self, case)

        setattr(test_class, f"test_{case['id']}", test)


def text(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


class ApplyTest(unittest.TestCase):
    pass


add_cases(
    ApplyTest,
    cases(),
    lambda self, case: self.assertEqual(
        text(case["expected"]),
        text(apply(case["data"], [(pair[0], pair[1]) for pair in case["kept"]])),
    ),
)


class SelectTest(unittest.TestCase):
    def test_returns_the_conforming_values_by_path(self) -> None:
        data = {"notice": {"closed": False, "text": "t"}, "sort": ""}
        kept = [
            ("notice.closed", True),
            ("sort", "title"),
            ("notice.hidden", 1),
            ("sort", {"a": 1}),
        ]
        self.assertEqual({"notice.closed": True, "sort": "title"}, select(data, kept))

    def test_ignores_a_value_outside_the_data_model(self) -> None:
        self.assertEqual({"a": 1}, apply({"a": 1}, [("a", 2**60)]))
        self.assertEqual({}, select({"a": 1}, [("a", 2**60)]))
        self.assertEqual({}, select({"a": 1}, []))


if __name__ == "__main__":
    unittest.main()
