# The verify cases of contracts/csrf.json (HY-24): whether a form value is a masked value of a token. The PHP and the Node
# server pass the same cases. Each case is a test method test_<id> (S6).
import unittest

from polyspec.hyper._csrf import verify

from .contracts import add_cases, file


class VerifyCasesTest(unittest.TestCase):
    pass


add_cases(
    VerifyCasesTest,
    file("csrf.json")["verify"],
    lambda self, case: self.assertEqual(
        case["valid"], verify(case["token"], case["value"])
    ),
)


if __name__ == "__main__":
    unittest.main()
