# The base path cases of contracts/routes.json (HY-8): the match of a request path under a base path. The PHP and the Node
# router pass the same cases. Each case is a test method test_<id> (S6).
import unittest

from polyspec.hyper.router import Router, strip_base_path

from .contracts import add_cases, file


class BasePathRoutesTest(unittest.TestCase):
    pass


def _under_base_path(self, case) -> None:
    fixture = file("routes.json")
    path = strip_base_path(case["path"], fixture["basePath"])
    router = Router(fixture["routes"])
    self.assertEqual(case["result"], None if path is None else router.match(path))


add_cases(BasePathRoutesTest, file("routes.json")["baseCases"], _under_base_path)


if __name__ == "__main__":
    unittest.main()
