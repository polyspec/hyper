"""The values of the template data model that handlers give the server (HY-44): the host binding of Python values,
followed by the same check that binding makes: a value belongs to the data model when it is None, a boolean, an
integer or a float within ±(2^53 − 1), a string without a lone surrogate, a list or a dictionary with string keys,
and lists and dictionaries nest no deeper than 64 levels (VAL-20). Any other object is not a value of the data
model."""

from __future__ import annotations

import math

_MAX_SAFE = 9007199254740991
_MAX_DEPTH = 64
# The message of each kind of failure (HY-44.8).
_NUMBER = "a number outside ±(2^53 − 1) is not a value of the data model (HY-44)"
_FINITE = "a number that is not finite is not a value of the data model (HY-44)"
_UTF8 = "a string that is not UTF-8 text is not a value of the data model (HY-44)"
_DEPTH = "lists and maps that nest deeper than 64 levels are not a value of the data model (HY-44)"
_TYPE = "a value or a map key of another type is not a value of the data model (HY-44)"
_FAILURES = frozenset((_NUMBER, _FINITE, _UTF8, _DEPTH, _TYPE))


class DataModel:
    @staticmethod
    def check(value: object) -> object:
        """Fails with ValueError when a value is not a value of the data model, and returns the value."""
        DataModel._walk(value)
        return value

    @staticmethod
    def contains(value: object) -> bool:
        """Returns True for a value of the data model; for example, integers outside ±(2^53 − 1) are not."""
        try:
            DataModel._walk(value)
            return True
        except ValueError as error:
            # HY-44.8: only a message of the data model is a value outside it; another failure is not swallowed.
            if str(error) not in _FAILURES:
                raise
            return False

    @staticmethod
    def _walk(value: object) -> None:
        """Fails with ValueError at the first item that is not a value of the data model; the items are kept on a
        stack with their nesting level, so a deep value fails by its level and not by the recursion of Python."""
        stack: list[tuple[object, int]] = [(value, 0)]
        while stack:
            item, level = stack.pop()
            if item is None or isinstance(item, bool):
                continue
            if isinstance(item, int):
                if abs(item) > _MAX_SAFE:
                    raise ValueError(_NUMBER)
                continue
            if isinstance(item, float):
                if not math.isfinite(item):
                    raise ValueError(_FINITE)
                if abs(item) > _MAX_SAFE:
                    raise ValueError(_NUMBER)
                continue
            if isinstance(item, str):
                if any(0xD800 <= ord(char) <= 0xDFFF for char in item):
                    raise ValueError(_UTF8)
                continue
            if isinstance(item, (list, dict)) and level + 1 > _MAX_DEPTH:
                raise ValueError(_DEPTH)
            if isinstance(item, list):
                stack.extend((child, level + 1) for child in reversed(item))
                continue
            if isinstance(item, dict):
                for key, child in reversed(list(item.items())):
                    if not isinstance(key, str):
                        raise ValueError(_TYPE)
                    stack.append((key, level + 1))
                    stack.append((child, level + 1))
                continue
            raise ValueError(_TYPE)
