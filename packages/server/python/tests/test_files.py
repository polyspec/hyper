# File parts of a multipart request (HY-113, HY-114): the files of a request as the contract cases state them, the
# refusal of a file over the file limit before the action runs, and the refusal of a file name that is not UTF-8.
import unittest

from polyspec.hyper._fields import Files

from .contracts import file
from .render.render_requests import FixtureTest

MULTIPART = {"Content-Type": "multipart/form-data; boundary=x"}
FORM_TYPES = {
    "form_types": ["application/x-www-form-urlencoded", "multipart/form-data"]
}


def upload(token: str, content: bytes, filename: bytes = b"a.txt") -> bytes:
    return (
        b'--x\r\nContent-Disposition: form-data; name="_csrf"\r\n\r\n'
        + token.encode()
        + b'\r\n--x\r\nContent-Disposition: form-data; name="name"\r\n\r\na\r\n'
        + b'--x\r\nContent-Disposition: form-data; name="upload"; filename="'
        + filename
        + b'"\r\n\r\n'
        + content
        + b"\r\n--x--\r\n"
    )


class FileParts(FixtureTest):
    def test_file_parts_of_the_contract_cases_are_the_files_of_the_request(
        self,
    ) -> None:
        for case in file("fields.json")["multipart"]:
            if "files" not in case:
                continue
            with self.subTest(case=case["id"]):
                files = Files.from_body(case["type"], case["body"].encode("latin-1"))
                self.assertIsNotNone(files)
                got = [
                    {
                        "name": name,
                        "filename": item.filename,
                        "contentType": item.content_type,
                        "content": item.content.decode("latin-1"),
                    }
                    for name in files.names()
                    for item in files.get(name)
                ]
                self.assertEqual(case["files"], got)

    def test_file_parts_over_the_file_limit_are_refused_before_the_action(self) -> None:
        # HY-114: 413 with the text of HY-59, and no action runs, when a file is larger than the file limit.
        token = self.token()
        large = upload(token, b"a" * 40)
        refused = self.send(
            "POST", "/add", MULTIPART, large, file_limit=32, **FORM_TYPES
        )
        self.assertEqual(413, refused.status)
        self.assertEqual("Content Too Large", refused.body)
        self.assertEqual(0, self.counter.actions)
        accepted = self.send(
            "POST",
            "/add",
            MULTIPART,
            upload(token, b"a" * 32),
            file_limit=32,
            **FORM_TYPES,
        )
        self.assertEqual(303, accepted.status)
        self.assertEqual(1, self.counter.actions)

    def test_file_parts_whose_name_is_not_utf_8_get_400(self) -> None:
        # HY-42 and HY-113: a file name that is not UTF-8 is refused like a name that is not UTF-8.
        token = self.token()
        response = self.send(
            "POST",
            "/add",
            MULTIPART,
            upload(token, b"a", filename=b"\xff.txt"),
            **FORM_TYPES,
        )
        self.assertEqual(400, response.status)
        self.assertEqual(0, self.counter.actions)


if __name__ == "__main__":
    unittest.main()
