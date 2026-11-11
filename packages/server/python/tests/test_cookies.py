# The parse cases of contracts/cookies.json (HY-129): the cookies of a Cookie header, as a map from names to values.
# The PHP, the Node and the Python server pass the same cases. Each case is a test method test_<id> (S6).
import unittest

from polyspec.hyper._cookies import parse

from .contracts import add_cases, file


def _header_bytes(header):
    # The header text has one character per byte (U+0000 to U+00FF); null is a request without the header.
    return None if header is None else header.encode("latin-1")


class ParseCasesTest(unittest.TestCase):
    def test_the_file_holds_parse_cases(self) -> None:
        self.assertTrue(file("cookies.json")["parse"])


add_cases(
    ParseCasesTest,
    file("cookies.json")["parse"],
    lambda self, case: self.assertEqual(
        case["cookies"], parse(_header_bytes(case["header"]))
    ),
)


if __name__ == "__main__":
    unittest.main()
