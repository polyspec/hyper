# The urlencoded cases of contracts/fields.json (HY-56, HY-57): a urlencoded text is the UTF-8 encoding of its JSON
# string. The PHP and the Node server pass the same cases. Each case is a test method test_<id> (S6).
import unittest

from polyspec.hyper.fields import Fields

from .contracts import add_cases, file
from .field_entries import entries


class UrlEncodedTest(unittest.TestCase):
    pass


add_cases(
    UrlEncodedTest,
    file("fields.json")["urlencoded"],
    lambda self, case: self.assertEqual(
        case["fields"], entries(Fields.parse(case["text"].encode("utf-8")))
    ),
)


if __name__ == "__main__":
    unittest.main()
