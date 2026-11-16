# The failure that a case step compares as `raises` (HY-132.2): only an error of hyper, whose classes include one named
# Hyper<Category>Error; any other error is an error of the step and fails the case as it was raised.
import unittest

from .case_rules import FAILURES, raises_of


class HyperValueError(ValueError):
    def __init__(self, kind: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind


def failure_of(error: BaseException) -> dict:
    try:
        raise error
    except FAILURES as failure:
        return raises_of(failure)


class CaseRulesTest(unittest.TestCase):
    def test_an_error_of_hyper_is_raises(self) -> None:
        self.assertEqual(
            failure_of(HyperValueError("data_depth", "too deep")),
            {
                "kind": "data_depth",
                "status": None,
                "category": "value",
                "message": "too deep",
            },
        )

    def test_an_error_of_the_step_is_no_raises(self) -> None:
        with self.assertRaisesRegex(ValueError, "^a step error$"):
            failure_of(ValueError("a step error"))


if __name__ == "__main__":
    unittest.main()
