# The encode cases of contracts/json.json (HY-17, HY-44): JSON text with the bytes of the PHP server. The PHP and the
# Node server pass the same cases. Each case is a test method test_<id> (S6).
import unittest

from polyspec.hyper._json_codec import decode, encode

from .contracts import add_cases, file


def finite(value):
    """A decoded value with the numbers outside the data model as floats, which encoding also writes."""
    if isinstance(value, list):
        return [finite(item) for item in value]
    if isinstance(value, dict):
        return {key: finite(item) for key, item in value.items()}
    return float(value.literal) if hasattr(value, "literal") else value


class EncodeTest(unittest.TestCase):
    pass


add_cases(
    EncodeTest,
    file("json.json")["encode"],
    lambda self, case: self.assertEqual(
        case["expected"], encode(finite(decode(case["json"])))
    ),
)


if __name__ == "__main__":
    unittest.main()
