# The build id that the server reads when the application opens (HY-125): the file build.json of the program directory
# holds exactly the key `build` with 64 lowercase hexadecimal characters, and every failure names the file's path.
import json
import tempfile
import unittest
from pathlib import Path

from polyspec.hyper._build import read_build_id

FIXTURE = Path(__file__).resolve().parents[2] / "php" / "tests" / "fixtures" / "build.json"
ONES = "1" * 64


class BuildIdTest(unittest.TestCase):
    def write(self, directory: str, text: str) -> Path:
        path = Path(directory) / "build.json"
        path.write_text(text, encoding="utf-8")
        return path

    def test_the_fixture_build_id_is_read(self) -> None:
        self.assertEqual(ONES, read_build_id(str(FIXTURE)))

    def test_a_missing_file_fails_with_its_path(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "build.json"
            with self.assertRaisesRegex(ValueError, str(path).replace("\\", "\\\\")):
                read_build_id(str(path))

    def test_an_invalid_file_fails_with_its_path(self) -> None:
        cases = [
            "{}",
            '{"build":"ABC"}',
            '{"build":"abc"}',
            '{"build":"' + "1" * 63 + '"}',
            '{"build":"' + "1" * 64 + '","x":1}',
            '{"build":' ,
            '["' + "1" * 64 + '"]',
        ]
        for text in cases:
            with self.subTest(text=text):
                with tempfile.TemporaryDirectory() as directory:
                    path = self.write(directory, text)
                    with self.assertRaisesRegex(ValueError, str(path)):
                        read_build_id(str(path))


if __name__ == "__main__":
    unittest.main()
