# The masked session token of the conformance cases (HY-24). The PHP and the JavaScript implementation pass the same
# cases of conformance/csrf.json.
import json
import unittest
from pathlib import Path

from polyspec.hyper.csrf import mask, masked, verify

CONFORMANCE = Path(__file__).resolve().parents[3] / 'conformance'


def file(name: str) -> dict:
    return json.loads((CONFORMANCE / name).read_text(encoding='utf-8'))


class MaskTest(unittest.TestCase):
    def test_every_case(self) -> None:
        for case in file('csrf.json')['mask']:
            with self.subTest(case['label']):
                self.assertEqual(case['value'], mask(case['token'], case['mask']))

    def test_a_new_mask_has_128_lowercase_digits(self) -> None:
        token = 'ab' * 32
        value = masked(token)
        self.assertEqual(128, len(value))
        self.assertTrue(all(char in '0123456789abcdef' for char in value))
        self.assertTrue(verify(token, value))


class VerifyTest(unittest.TestCase):
    def test_every_case(self) -> None:
        for case in file('csrf.json')['verify']:
            with self.subTest(case['label']):
                self.assertEqual(case['valid'], verify(case['token'], case['value']))


if __name__ == '__main__':
    unittest.main()
