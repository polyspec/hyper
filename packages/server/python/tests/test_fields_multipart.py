# The multipart cases of contracts/fields.json (HY-56, HY-57): a multipart body is text whose characters are its bytes.
# The PHP and the Node server pass the same cases. Each case is a test method test_<id> (S6).
import unittest

from polyspec.hyper.fields import Fields

from .contracts import add_cases, file
from .field_entries import entries


class MultipartTest(unittest.TestCase):
    pass


add_cases(
    MultipartTest,
    file("fields.json")["multipart"],
    lambda self, case: self.assertEqual(
        case["fields"],
        entries(Fields.from_body(case["type"], case["body"].encode("latin-1"))),
    ),
)


if __name__ == "__main__":
    unittest.main()
