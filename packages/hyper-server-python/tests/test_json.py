# JSON text with the bytes of the PHP server and kept values decoded as PHP json_decode reads them (HY-17, HY-38,
# HY-40, HY-54). The PHP and the JavaScript server pass the same cases of conformance/json.json.
import json
import math
import unittest
from pathlib import Path

from polyspec.hyper.json_codec import JsonDecodeError, decode, encode, in_data_model

CONFORMANCE = Path(__file__).resolve().parents[3] / 'conformance'


def file(name: str) -> dict:
    return json.loads((CONFORMANCE / name).read_text(encoding='utf-8'))


def finite(value):
    """A decoded value with the numbers outside the data model as floats, which encoding also writes."""
    if isinstance(value, list):
        return [finite(item) for item in value]
    if isinstance(value, dict):
        return {key: finite(item) for key, item in value.items()}
    return float(value.literal) if hasattr(value, 'literal') else value


class EncodeTest(unittest.TestCase):
    def test_every_case(self) -> None:
        for case in file('json.json')['encode']:
            with self.subTest(case['label']):
                self.assertEqual(case['expected'], encode(finite(decode(case['json']))))


class DecodeTest(unittest.TestCase):
    def test_every_case(self) -> None:
        for case in file('json.json')['decode']:
            with self.subTest(case['label']):
                try:
                    result = 'value' if in_data_model(decode(case['json'])) else 'outside'
                except JsonDecodeError:
                    result = 'error'
                self.assertEqual(case['result'], result)


class NumberTest(unittest.TestCase):
    def test_an_integer_outside_the_safe_range_encodes_as_a_float(self) -> None:
        self.assertEqual('1.0e+20', encode(float(10 ** 20)))

    def test_a_number_that_is_not_finite_fails(self) -> None:
        with self.assertRaises(ValueError):
            encode(math.inf)

    def test_an_integer_of_the_safe_range_encodes_in_decimal(self) -> None:
        self.assertEqual('9007199254740991', encode(9007199254740991))
        self.assertEqual('-7', encode(-7))

    def test_negative_zero_keeps_its_sign(self) -> None:
        self.assertEqual('-0', encode(-0.0))
        self.assertEqual('0', encode(0))


class DecodeModelTest(unittest.TestCase):
    def test_a_decoded_integer_is_an_integer_and_a_float_literal_is_a_float(self) -> None:
        self.assertIsInstance(decode('7'), int)
        self.assertIsInstance(decode('7.0'), float)
        self.assertIsInstance(decode('1e2'), float)

    def test_a_surrogate_pair_becomes_one_character(self) -> None:
        self.assertEqual('\U0001f600', decode('"\\ud83d\\ude00"'))


if __name__ == '__main__':
    unittest.main()
