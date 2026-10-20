# The selection of kept values beyond the cases of contracts/keep.json (HY-38).
import unittest

from polyspec.hyper._kept import apply, select


class SelectTest(unittest.TestCase):
    def test_returns_the_conforming_values_by_path(self) -> None:
        data = {"notice": {"closed": False, "text": "t"}, "sort": ""}
        kept = [
            ("notice.closed", True),
            ("sort", "title"),
            ("notice.hidden", 1),
            ("sort", {"a": 1}),
        ]
        self.assertEqual({"notice.closed": True, "sort": "title"}, select(data, kept))

    def test_ignores_a_value_outside_the_data_model(self) -> None:
        self.assertEqual({"a": 1}, apply({"a": 1}, [("a", 2**60)]))
        self.assertEqual({}, select({"a": 1}, [("a", 2**60)]))
        self.assertEqual({}, select({"a": 1}, []))


if __name__ == "__main__":
    unittest.main()
