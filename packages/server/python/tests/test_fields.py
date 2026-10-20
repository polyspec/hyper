# Query and form values of the conformance cases (HY-56, HY-57). The PHP and the JavaScript implementation pass the
# same cases of contracts/fields.json: a urlencoded text is the UTF-8 encoding of its JSON string, and a multipart
# body is text whose characters are its bytes.
import unittest

from contracts import add_cases, file
from polyspec.hyper.fields import Fields


def entries(fields: Fields | None) -> list | None:
    if fields is None:
        return None
    return [[name, fields.get(name)] for name in fields.names()]


class UrlEncodedTest(unittest.TestCase):
    pass


add_cases(
    UrlEncodedTest,
    file("fields.json")["urlencoded"],
    lambda self, case: self.assertEqual(
        case["fields"], entries(Fields.parse(case["text"].encode("utf-8")))
    ),
)


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


class HasTest(unittest.TestCase):
    def test_absent_name_has_no_values(self) -> None:
        """Fields.has tells a name with values from an absent name, as PHP Fields::has does (HY-56)."""
        fields = Fields.parse(b"1=x")
        self.assertIsNotNone(fields)
        self.assertTrue(fields.has("1"))
        self.assertFalse(fields.has("2"))
        self.assertEqual([], fields.get("2"))


class BodyTypeTest(unittest.TestCase):
    def test_an_urlencoded_body_with_parameters_and_case_reads_its_fields(self) -> None:
        self.assertEqual(
            [["roles[]", ["a", "b"]]],
            entries(
                Fields.from_body(
                    "application/x-www-form-urlencoded; charset=UTF-8",
                    b"roles%5B%5D=a&roles[]=b",
                )
            ),
        )

    def test_an_urlencoded_body_of_another_case_reads_its_fields(self) -> None:
        self.assertEqual(
            [["a", ["1"]]],
            entries(Fields.from_body("Application/X-WWW-Form-Urlencoded", b"a=1")),
        )

    def test_a_body_of_another_type_has_no_fields(self) -> None:
        self.assertEqual([], entries(Fields.from_body("text/plain", b"a=1")))
        self.assertEqual([], entries(Fields.from_body("", b"a=1")))

    def test_a_multipart_body_without_a_boundary_has_no_fields(self) -> None:
        self.assertEqual([], entries(Fields.from_body("multipart/form-data", b"--x--")))


if __name__ == "__main__":
    unittest.main()
