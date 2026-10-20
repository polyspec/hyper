# The route paths that a router refuses, beyond the cases of contracts/routes.json and contracts/rest.json (HY-4, HY-49).
import unittest

from polyspec.hyper._router import Router

from .contracts import file


class InvalidPathsTest(unittest.TestCase):
    def test_every_invalid_path_fails(self) -> None:
        for contract in ("routes.json", "rest.json"):
            for path in file(contract)["invalidPaths"]:
                with self.subTest(path):
                    with self.assertRaises(ValueError):
                        Router([{"name": "x", "path": path}])


if __name__ == "__main__":
    unittest.main()
