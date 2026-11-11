"""The values of the template data model that handlers give the server (HY-44): the host binding of Python values,
followed by the same check that binding makes: a value belongs to the data model when it is None, a boolean, an
integer or a float within ±(2^53 − 1), a string without a lone surrogate, a list or a dictionary with string keys,
and lists and dictionaries nest no deeper than 64 levels (VAL-20). Any other object is not a value of the data
model."""

from __future__ import annotations

import math

_MAX_SAFE = 9007199254740991
_MAX_DEPTH = 64


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
        except ValueError:
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
                    raise ValueError(f"integer {item} is outside the safe range")
                continue
            if isinstance(item, float):
                if not math.isfinite(item):
                    raise ValueError("number is not finite")
                if abs(item) > _MAX_SAFE:
                    raise ValueError(f"number {item} is outside the safe range")
                continue
            if isinstance(item, str):
                if any(0xD800 <= ord(char) <= 0xDFFF for char in item):
                    raise ValueError("string contains an unpaired surrogate")
                continue
            if isinstance(item, (list, dict)) and level + 1 > _MAX_DEPTH:
                raise ValueError(
                    f"lists and dictionaries nest deeper than {_MAX_DEPTH} levels"
                )
            if isinstance(item, list):
                stack.extend((child, level + 1) for child in reversed(item))
                continue
            if isinstance(item, dict):
                for key, child in reversed(list(item.items())):
                    if not isinstance(key, str):
                        raise ValueError("map key is not a string")
                    stack.append((key, level + 1))
                    stack.append((child, level + 1))
                continue
            raise ValueError(f"a {type(item).__name__} value has no binding")
