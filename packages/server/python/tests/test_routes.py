# The route cases of contracts/routes.json (HY-4 to HY-7): the match of a request path. The PHP and the Node router pass the
# same cases. Each case is a test method test_<id> (S6).
import unittest

from polyspec.hyper._router import Router

from .contracts import add_cases, file


class RoutesTest(unittest.TestCase):
    pass


add_cases(
    RoutesTest,
    file("routes.json")["cases"],
    lambda self, case: self.assertEqual(
        case["result"], Router(file("routes.json")["routes"]).match(case["path"])
    ),
)


if __name__ == "__main__":
    unittest.main()
