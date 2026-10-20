# The JSON codec beyond the cases of contracts/json.json (HY-17, HY-44): the bytes of numbers and the decoded model.
import math
import unittest

from polyspec.hyper._json_codec import decode, encode


class NumberTest(unittest.TestCase):
    def test_an_integer_outside_the_safe_range_encodes_as_a_float(self) -> None:
        self.assertEqual("1.0e+20", encode(float(10**20)))

    def test_a_number_that_is_not_finite_fails(self) -> None:
        with self.assertRaises(ValueError):
            encode(math.inf)

    def test_an_integer_of_the_safe_range_encodes_in_decimal(self) -> None:
        self.assertEqual("9007199254740991", encode(9007199254740991))
        self.assertEqual("-7", encode(-7))

    def test_negative_zero_keeps_its_sign(self) -> None:
        self.assertEqual("-0", encode(-0.0))
        self.assertEqual("0", encode(0))


class DecodeModelTest(unittest.TestCase):
    def test_a_decoded_integer_is_an_integer_and_a_float_literal_is_a_float(
        self,
    ) -> None:
        self.assertIsInstance(decode("7"), int)
        self.assertIsInstance(decode("7.0"), float)
        self.assertIsInstance(decode("1e2"), float)

    def test_a_surrogate_pair_becomes_one_character(self) -> None:
        self.assertEqual("\U0001f600", decode('"\\ud83d\\ude00"'))


if __name__ == "__main__":
    unittest.main()
