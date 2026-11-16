"""The values of the template data model that handlers give the server (HY-44): the host binding of Python values,
followed by the same check that binding makes: a value belongs to the data model when it is None, a boolean, an
integer or a float within ±(2^53 − 1), a string without a lone surrogate, a list or a dictionary with string keys,
and lists and dictionaries nest no deeper than 64 levels (VAL-20). Any other object is not a value of the data
model."""

from __future__ import annotations

import math

from ..app._core_rules import core_rules

_MAX_SAFE = 9007199254740991
_MAX_DEPTH = 64
# The kind of each failure (HY-44.8), the kind of the template data model, and its message.
_NUMBER = (
    "data_number_range",
    "a number outside ±(2^53 − 1) is not a value of the data model (HY-44)",
)
_FINITE = (
    "data_number_not_finite",
    "a number that is not finite is not a value of the data model (HY-44)",
)
_UTF8 = (
    "data_invalid_utf8",
    "a string that is not UTF-8 text is not a value of the data model (HY-44)",
)
_DEPTH = (
    "data_depth",
    "lists and maps that nest deeper than 64 levels are not a value of the data model (HY-44)",
)
_TYPE = (
    "data_unsupported_type",
    "a value or a map key of another type is not a value of the data model (HY-44)",
)
_KINDS = frozenset(kind for kind, _ in (_NUMBER, _FINITE, _UTF8, _DEPTH, _TYPE))


def _failure(failure: tuple[str, str]) -> Exception:
    """The error of a failure of the data model: of the category type for `data_unsupported_type` and of the category
    value for every other kind, as the template data model gives them (HY-132.3)."""
    kind, message = failure
    if kind == "data_unsupported_type":
        return core_rules().type_error(message, kind)
    return core_rules().value_error(message, kind)


class DataModel:
    @staticmethod
    def check(value: object) -> object:
        """Fails with the error of its kind when a value is not a value of the data model, and returns the value."""
        DataModel._walk(value)
        return value

    @staticmethod
    def contains(value: object) -> bool:
        """Returns True for a value of the data model; for example, integers outside ±(2^53 − 1) are not."""
        try:
            DataModel.check(value)
            return True
        except (ValueError, TypeError) as error:
            # HY-44.8: only a kind of the data model is a value outside it; another failure is not swallowed.
            if getattr(error, "kind", None) not in _KINDS:
                raise
            return False

    @staticmethod
    def _walk(value: object) -> None:
        """Fails with the error of its kind at the first item that is not a value of the data model; the items are kept on a
        stack with their nesting level, so a deep value fails by its level and not by the recursion of Python."""
        stack: list[tuple[object, int]] = [(value, 0)]
        while stack:
            item, level = stack.pop()
            if item is None or isinstance(item, bool):
                continue
            if isinstance(item, int):
                if abs(item) > _MAX_SAFE:
                    raise _failure(_NUMBER)
                continue
            if isinstance(item, float):
                if not math.isfinite(item):
                    raise _failure(_FINITE)
                if abs(item) > _MAX_SAFE:
                    raise _failure(_NUMBER)
                continue
            if isinstance(item, str):
                if any(0xD800 <= ord(char) <= 0xDFFF for char in item):
                    raise _failure(_UTF8)
                continue
            if isinstance(item, (list, dict)) and level + 1 > _MAX_DEPTH:
                raise _failure(_DEPTH)
            if isinstance(item, list):
                stack.extend((child, level + 1) for child in reversed(item))
                continue
            if isinstance(item, dict):
                for key, child in reversed(list(item.items())):
                    if not isinstance(key, str):
                        raise _failure(_TYPE)
                    stack.append((key, level + 1))
                    stack.append((child, level + 1))
                continue
            raise _failure(_TYPE)
