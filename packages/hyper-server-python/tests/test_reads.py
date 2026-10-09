# The data that the read paths keep of the conformance cases (HY-73). The browser package and the Node server pass
# the same cases of conformance/reads.json; the kept data is compared as JSON text, so an empty map stays a map.
import json
import unittest
from pathlib import Path

from polyspec.hyper.json_codec import encode
from polyspec.hyper.reads import Reads

CONFORMANCE = Path(__file__).resolve().parents[3] / 'conformance'


def file(name: str) -> dict:
    return json.loads((CONFORMANCE / name).read_text(encoding='utf-8'))


class ReadsTest(unittest.TestCase):
    def test_keeps_the_read_paths_of_every_case(self) -> None:
        for case in file('reads.json')['cases']:
            with self.subTest(case['label']):
                self.assertEqual(encode({'kept': case['kept']}), encode({'kept': Reads.keep(case['data'], case['reads'])}))


if __name__ == '__main__':
    unittest.main()
