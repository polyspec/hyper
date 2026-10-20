# The masked session token beyond the cases of contracts/csrf.json (HY-24).
import unittest

from polyspec.hyper.csrf import masked, verify


class MaskTest(unittest.TestCase):
    def test_a_new_mask_has_128_lowercase_digits(self) -> None:
        token = "ab" * 32
        value = masked(token)
        self.assertEqual(128, len(value))
        self.assertTrue(all(char in "0123456789abcdef" for char in value))
        self.assertTrue(verify(token, value))


if __name__ == "__main__":
    unittest.main()
