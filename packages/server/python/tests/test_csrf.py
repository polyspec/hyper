# The masked session token of the conformance cases (HY-24). The PHP and the JavaScript implementation pass the same
# cases of contracts/csrf.json.
import json
import unittest
from pathlib import Path

from polyspec.hyper.csrf import mask, masked, verify

CONTRACTS = Path(__file__).resolve().parents[4] / "contracts"


def file(name: str) -> dict:
    return json.loads((CONTRACTS / name).read_text(encoding="utf-8"))


def add_cases(test_class, cases, check):
    """Adds the test method test_<id> of each case, which runs check(self, case) for it (S6)."""
    for case in cases:

        def test(self, case=case):
            check(self, case)

        setattr(test_class, f"test_{case['id']}", test)


class MaskTest(unittest.TestCase):
    def test_a_new_mask_has_128_lowercase_digits(self) -> None:
        token = "ab" * 32
        value = masked(token)
        self.assertEqual(128, len(value))
        self.assertTrue(all(char in "0123456789abcdef" for char in value))
        self.assertTrue(verify(token, value))


class VerifyTest(unittest.TestCase):
    pass


add_cases(MaskTest, file("csrf.json")["mask"], lambda self, case: self.assertEqual(case["value"], mask(case["token"], case["mask"])))
add_cases(VerifyTest, file("csrf.json")["verify"], lambda self, case: self.assertEqual(case["valid"], verify(case["token"], case["value"])))


if __name__ == "__main__":
    unittest.main()
