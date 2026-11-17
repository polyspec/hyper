# The selection of cases of the case runner (H35.9-11, HR-84): the names of RECIPE_CASES select the cases of a file, of
# a section of a file or of an id, and a name that selects no case of the runner fails with the selection.
import unittest

from .case_selection import names, select

CASES = [
    ("reads.json", "cases", "first"),
    ("reads.json", "errors", "second"),
    ("app.json", "opens", "third"),
    ("app.json", "cases", "first"),
]


def selected(selection: str) -> list[str]:
    chosen = select(selection, CASES, lambda case: case)
    return [f"{file}#{section} {identity}" for file, section, identity in chosen]


class CaseSelectionTest(unittest.TestCase):
    def test_a_file_name_selects_the_cases_of_the_file(self) -> None:
        self.assertEqual(
            selected("reads.json"),
            ["reads.json#cases first", "reads.json#errors second"],
        )

    def test_a_file_and_a_section_select_the_cases_of_the_section(self) -> None:
        self.assertEqual(selected("app.json#opens"), ["app.json#opens third"])

    def test_an_id_selects_its_cases_in_every_file(self) -> None:
        self.assertEqual(
            selected("first"), ["reads.json#cases first", "app.json#cases first"]
        )

    def test_several_names_select_each_case_once_in_the_order_of_the_runner(
        self,
    ) -> None:
        self.assertEqual(
            selected(" app.json#opens\tsecond  reads.json#errors "),
            ["reads.json#errors second", "app.json#opens third"],
        )

    def test_a_name_that_selects_no_case_fails_with_the_selection(self) -> None:
        with self.assertRaises(ValueError) as raised:
            selected("reads.json routes.json app.json#closes fourth")
        self.assertEqual(
            str(raised.exception),
            'the selection "reads.json routes.json app.json#closes fourth" of the python runner'
            " selects no case for routes.json, app.json#closes, fourth",
        )

    def test_a_selection_without_a_name_fails(self) -> None:
        with self.assertRaises(ValueError) as raised:
            selected(" \t")
        self.assertEqual(
            str(raised.exception),
            'the selection " \t" of the python runner names no case',
        )

    def test_the_names_of_a_selection_are_its_words(self) -> None:
        self.assertEqual(
            names(" reads.json \n app.json#opens"), ["reads.json", "app.json#opens"]
        )


if __name__ == "__main__":
    unittest.main()
