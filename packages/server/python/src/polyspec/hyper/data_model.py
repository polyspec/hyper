"""The values of the template data model that handlers give the server (HY-44): the host binding of Python values,
followed by the same check that binding makes: a value belongs to the data model when it is None, a boolean, an
integer or a float within ±(2^53 − 1), a string without a lone surrogate, a list or a dictionary with string keys,
and lists and dictionaries nest no deeper than 64 levels (VAL-20). Any other object is not a value of the data
model."""

from __future__ import annotations

import math

MAX_SAFE = 9007199254740991
MAX_DEPTH = 64


def check(value) -> None:
    """Fails with ValueError when a value is not a value of the data model."""
    _check(value, 0)


def contains(value) -> bool:
    """Returns True for a value of the data model; for example, integers outside ±(2^53 − 1) are not."""
    try:
        check(value)
        return True
    except ValueError:
        return False


def _check(value, level: int) -> None:
    if value is None or isinstance(value, bool):
        return
    if isinstance(value, int):
        if abs(value) > MAX_SAFE:
            raise ValueError(f'integer {value} is outside the safe range')
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError('number is not finite')
        if abs(value) > MAX_SAFE:
            raise ValueError(f'number {value} is outside the safe range')
        return
    if isinstance(value, str):
        _check_text(value)
        return
    if isinstance(value, list):
        _check_level(level + 1)
        for item in value:
            _check(item, level + 1)
        return
    if isinstance(value, dict):
        _check_level(level + 1)
        for key, item in value.items():
            if not isinstance(key, str):
                raise ValueError('map key is not a string')
            _check_text(key)
            _check(item, level + 1)
        return
    raise ValueError(f'a {type(value).__name__} value has no binding')


def _check_text(text: str) -> None:
    index = 0
    while index < len(text):
        code = ord(text[index])
        if 0xD800 <= code <= 0xDFFF:
            raise ValueError('string contains an unpaired surrogate')
        index += 1


def _check_level(level: int) -> None:
    if level > MAX_DEPTH:
        raise ValueError(f'lists and dictionaries nest deeper than {MAX_DEPTH} levels')
