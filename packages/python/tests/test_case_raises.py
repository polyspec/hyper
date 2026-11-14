# The comparison `raises` of the case reader (HYR-11, HY-132.7): the error of a case that expects a failure is exactly the
# class of the category `value` that the members of its section raise, the generated class of HY-132.2 for a section
# whose members call the core and the builtin base class for a section whose members do not, and it has the kind that
# the case states. The classes of the core are a stand-in here, so that these tests need no native module; the last test
# reads the generated module of the binding.
import unittest
from unittest import mock

from . import case_rules
from .case_reader import CaseReader

CORE = sorted(case_rules.CORE_MEMBERS)[:2]
LEGACY = ["renderer.open"]


class StandInValueError(ValueError):
    """The class of the category `value` that the binding generates, as a stand-in: a ValueError with a kind."""

    def __init__(self, message: str, kind: str) -> None:
        super().__init__(message)
        self.kind = kind


def stand_in_class(category: str) -> type[BaseException]:
    if category != "value":
        raise AssertionError(f"the comparison raises asked for the category {category}")
    return StandInValueError


def outcome_line(members: list[str], observed: object) -> str:
    """The result line of a case of a section with the outcome `open` of the comparison raises."""
    spec = {
        "runners": ["python"],
        "uses": [],
        "fields": {"id": {"role": "id"}, "label": {"role": "label"}},
        "outcomes": {"open": {"compare": "raises", "sentence": "HY-106.21"}},
        "members": members,
    }
    reader = CaseReader("file.json", "section", {"id": "c", "label": "l"}, {}, spec, None)
    reader.outcome("open", observed)
    return reader.line()


def field_line(members: list[str], expected: object, observed: object) -> str:
    """The result line of a case that states the field `openFails` of the comparison raises."""
    spec = {
        "runners": ["python"],
        "uses": [],
        "fields": {
            "id": {"role": "id"},
            "label": {"role": "label"},
            "openFails": {"role": "expected", "compare": "raises", "sentence": "HY-106.21", "optional": True},
        },
        "members": members,
    }
    case = {"id": "c", "label": "l", "openFails": expected}
    reader = CaseReader("file.json", "section", case, {}, spec, None)
    reader.compare("openFails", observed)
    return reader.line()


@mock.patch.object(case_rules, "core_class", stand_in_class)
class CaseRaisesTest(unittest.TestCase):
    def test_a_section_of_core_members_expects_the_generated_class(self):
        self.assertEqual(
            outcome_line(CORE, StandInValueError("refused", "invalid_application")), "CASE file.json c PASS"
        )
        self.assertEqual(outcome_line(CORE, ValueError("refused")), "CASE file.json c FAIL FIELD_DIFFERS open")

    def test_a_section_of_members_that_do_not_call_the_core_expects_the_base_class(self):
        self.assertEqual(outcome_line(LEGACY, ValueError("refused")), "CASE file.json c PASS")
        self.assertEqual(
            outcome_line(LEGACY, StandInValueError("refused", "invalid_application")),
            "CASE file.json c FAIL FIELD_DIFFERS open",
        )

    def test_a_section_without_members_expects_the_base_class(self):
        self.assertEqual(outcome_line([], ValueError("refused")), "CASE file.json c PASS")

    def test_a_class_of_another_category_fails(self):
        self.assertEqual(outcome_line(LEGACY, TypeError("refused")), "CASE file.json c FAIL FIELD_DIFFERS open")
        self.assertEqual(outcome_line(LEGACY, None), "CASE file.json c FAIL FIELD_DIFFERS open")

    def test_a_section_of_both_kinds_of_members_fails_with_case_error(self):
        line = outcome_line([CORE[0], LEGACY[0]], ValueError("refused"))
        self.assertTrue(line.startswith("CASE file.json c FAIL CASE_ERROR "), line)
        self.assertIn(CORE[0], line)
        self.assertIn(LEGACY[0], line)

    def test_a_stated_kind_is_compared(self):
        error = StandInValueError("refused", "invalid_application")
        self.assertEqual(field_line(CORE, "invalid_application", error), "CASE file.json c PASS")
        self.assertEqual(
            field_line(CORE, "invalid_build", error), "CASE file.json c FAIL FIELD_DIFFERS openFails"
        )
        self.assertEqual(field_line(CORE, True, error), "CASE file.json c PASS")

    def test_false_expects_no_failure(self):
        self.assertEqual(field_line(CORE, False, None), "CASE file.json c PASS")
        self.assertEqual(
            field_line(CORE, False, ValueError("refused")), "CASE file.json c FAIL FIELD_DIFFERS openFails"
        )


class CoreClassTest(unittest.TestCase):
    def test_the_class_of_each_category_is_the_generated_one_and_extends_its_base_class(self):
        from polyspec.hyper._binding import _errors

        for category, name in case_rules.CORE_CLASS_NAMES.items():
            with self.subTest(category):
                cls = case_rules.core_class(category)
                self.assertIs(cls, getattr(_errors, name))
                self.assertIn(case_rules.BASE_CLASSES[category], cls.__mro__)
                self.assertIsNot(cls, case_rules.BASE_CLASSES[category])
