# The decode cases of contracts/json.json (HY-38, HY-40, HY-44): kept values decoded as PHP json_decode reads them. The
# PHP and the Node server pass the same cases. Each case is a test method test_<id> (S6).
import unittest

from polyspec.hyper._json_codec import JsonDecodeError, decode, in_data_model

from .contracts import add_cases, file


def decode_result(text: str) -> str:
    try:
        return "value" if in_data_model(decode(text)) else "outside"
    except JsonDecodeError:
        return "error"


class DecodeTest(unittest.TestCase):
    pass


add_cases(
    DecodeTest,
    file("json.json")["decode"],
    lambda self, case: self.assertEqual(case["result"], decode_result(case["json"])),
)


if __name__ == "__main__":
    unittest.main()
