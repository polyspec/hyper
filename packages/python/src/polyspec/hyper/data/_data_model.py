"""The values of the template data model that handlers give the server (HY-44): the host binding of Python values,
followed by the same check that binding makes: a value belongs to the data model when it is None, a boolean, an
integer or a float within ±(2^53 − 1), a string without a lone surrogate, a list or a dictionary with string keys,
and lists and dictionaries nest no deeper than 64 levels (VAL-20). Any other object is not a value of the data
model."""

from __future__ import annotations

import inspect
import math

from ..app._core_rules import core_rules

_MAX_SAFE = 9007199254740991
_MAX_DEPTH = 64
# The kinds of a failure (HY-44.8), the kinds of the template data model.
_NUMBER = "data_number_range"
_FINITE = "data_number_not_finite"
_UTF8 = "data_invalid_utf8"
_DEPTH = "data_depth"
_TYPE = "data_unsupported_type"
_KINDS = frozenset((_NUMBER, _FINITE, _UTF8, _DEPTH, _TYPE))


def _float_text(value: float) -> str:
    """The text of a float outside ±(2^53 − 1) as Rust writes an f64: every such float is an integer, written with all
    its digits and no exponent."""
    return str(int(value))


def _unsupported(item: object) -> str:
    """The message of a value that binding does not take, by the kind of host value that binding gives it."""
    if type(item) is bytes:
        return "a byte string is not a template value"
    if inspect.isfunction(item) or inspect.ismethod(item) or inspect.isbuiltin(item):
        return "a function is not a template value"
    if isinstance(item, (int, str, bytes)):
        # A subclass of int, str or bytes is a value outside the closed set of binding.
        return f"a value of the type {type(item).__name__} is not a template value"
    # VAL-19: binding keeps an application object as a native object, which has no JSON form.
    return "a native object has no JSON form"


def _failure(kind: str, text: str) -> Exception:
    """The error of a failure of the data model: of the category type for `data_unsupported_type` and of the category
    value for every other kind, as the template data model gives them (HY-132.3). Its message is the kind, a colon and
    the message of the template data model, the text of an error without a template and a position (HY-44.12)."""
    message = f"{kind}: {text}"
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
                    raise _failure(_NUMBER, f"number {item} is outside the safe range")
                continue
            if isinstance(item, float):
                if not math.isfinite(item):
                    raise _failure(_FINITE, "number is not finite")
                if abs(item) > _MAX_SAFE:
                    raise _failure(_NUMBER, f"number {_float_text(item)} is outside the safe range")
                continue
            if isinstance(item, str):
                surrogate = next((ord(char) for char in item if 0xD800 <= ord(char) <= 0xDFFF), None)
                if surrogate is not None:
                    raise _failure(
                        _UTF8, f"a string is not valid Unicode text: U+{surrogate:04X} is no scalar value"
                    )
                continue
            if isinstance(item, (list, dict)) and level + 1 > _MAX_DEPTH:
                raise _failure(_DEPTH, "lists and maps nest deeper than 64 levels")
            if isinstance(item, list):
                stack.extend((child, level + 1) for child in reversed(item))
                continue
            if isinstance(item, dict):
                for key, child in reversed(list(item.items())):
                    if not isinstance(key, str):
                        raise _failure(_TYPE, "a map key that is not a string is not a template value")
                    stack.append((key, level + 1))
                    stack.append((child, level + 1))
                continue
            raise _failure(_TYPE, _unsupported(item))
