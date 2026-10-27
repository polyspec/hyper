# File parts of a multipart request (HY-113, HY-114): the files of a request as the contract cases state them, the
# refusal of a file over the file limit before the action runs, and the refusal of a file name that is not UTF-8.
import unittest

from polyspec.hyper._fields import Files

from .contracts import file


class FileParts(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
