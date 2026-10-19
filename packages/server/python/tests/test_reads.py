# The data that the read paths keep of the conformance cases (HY-73). The browser package and the Node server pass
# the same cases of contracts/reads.json; the kept data is compared as JSON text, so an empty map stays a map. Each
# case is a test method test_<id> that the parity check reads by its id (S6).
import json
import unittest
from pathlib import Path

from polyspec.hyper.json_codec import encode
from polyspec.hyper.reads import Reads

CONTRACTS = Path(__file__).resolve().parents[4] / "contracts"


def file(name: str) -> dict:
    return json.loads((CONTRACTS / name).read_text(encoding="utf-8"))


class ReadsTest(unittest.TestCase):
    pass


def add_cases(test_class, cases, check):
    """Adds the test method test_<id> of each case, which runs check(self, case) for it (S6)."""
    for case in cases:

        def test(self, case=case):
            check(self, case)

        setattr(test_class, f"test_{case['id']}", test)


add_cases(
    ReadsTest,
    file("reads.json")["cases"],
    lambda self, case: self.assertEqual(
        encode({"kept": case["kept"]}),
        encode({"kept": Reads.keep(case["data"], case["reads"])}),
    ),
)


if __name__ == "__main__":
    unittest.main()
