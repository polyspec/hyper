# The data that the read paths keep of the conformance cases (HY-73). The browser package and the Node server pass
# the same cases of contracts/reads.json; the kept data is compared as JSON text, so an empty map stays a map. Each
# case is a test method test_<id> that the parity check reads by its id (S6).
import unittest

from .contracts import add_cases, file
from polyspec.hyper._json_codec import encode
from polyspec.hyper._reads import Reads


class ReadsTest(unittest.TestCase):
    pass


add_cases(
    ReadsTest,
    file("reads.json")["cases"],
    lambda self, case: self.assertEqual(
        encode({"kept": case["kept"]}),
        encode({"kept": Reads.keep(case["data"], case["reads"])}),
    ),
)


if __name__ == "__main__":
    unittest.main()
