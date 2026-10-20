# The cases of contracts/keep.json (HY-38, HY-41): the kept values that conform are applied to the data, which is compared as
# JSON text, so an empty map stays a map. The PHP and the Node server pass the same cases. Each case is a test method
# test_<id> (S6).
import json
import unittest

from polyspec.hyper.kept import apply

from .contracts import add_cases, file


def text(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


class ApplyTest(unittest.TestCase):
    pass


add_cases(
    ApplyTest,
    file("keep.json")["cases"],
    lambda self, case: self.assertEqual(
        text(case["expected"]),
        text(apply(case["data"], [(pair[0], pair[1]) for pair in case["kept"]])),
    ),
)


if __name__ == "__main__":
    unittest.main()
