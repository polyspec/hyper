# The mask cases of contracts/csrf.json (HY-24): the value of a token with a mask. The PHP and the Node server pass the same
# cases. Each case is a test method test_<id> (S6).
import unittest

from polyspec.hyper._csrf import mask

from .contracts import add_cases, file


class MaskCasesTest(unittest.TestCase):
    pass


add_cases(
    MaskCasesTest,
    file("csrf.json")["mask"],
    lambda self, case: self.assertEqual(
        case["value"], mask(case["token"], case["mask"])
    ),
)


if __name__ == "__main__":
    unittest.main()
