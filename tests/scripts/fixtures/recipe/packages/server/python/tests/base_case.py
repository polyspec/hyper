import unittest


class BaseCase(unittest.TestCase):
    """A test case of another file, which holds no test of its own."""


class Mixin:
    """A class without a test case, whose test runs in the class that extends both."""

    def test_mixed(self) -> None:
        pass
