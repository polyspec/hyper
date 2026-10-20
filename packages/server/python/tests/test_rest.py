# The rest cases of contracts/rest.json (HY-49): a rest parameter takes the rest of the path. The PHP and the Node router pass
# the same cases. Each case is a test method test_<id> (S6).
import unittest

from polyspec.hyper.router import Router

from .contracts import add_cases, file


class RestTest(unittest.TestCase):
    pass


add_cases(
    RestTest,
    file("rest.json")["cases"],
    lambda self, case: self.assertEqual(
        case["result"], Router(file("rest.json")["routes"]).match(case["path"])
    ),
)


if __name__ == "__main__":
    unittest.main()
