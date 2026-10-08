"""Kept values (HY-37, HY-38). Values outside the template data model are ignored. The PHP and the JavaScript
implementation follow the same rules; all three pass the cases of conformance/keep.json."""

from __future__ import annotations

import re
from typing import Optional

from .data_model import contains

KINDS = ('server', 'cookie', 'localStorage', 'sessionStorage')

# One kept value: its path and the value (HY-33).
Pair = tuple[str, object]


def apply(data: dict, kept: list[Pair]) -> dict:
    """Replaces values at kept paths when the path exists and the kept value conforms to its value."""
    for path, value in kept:
        if contains(value):
            data = _replace(data, path.split('.'), value)[0]
    return data


def select(data: dict, kept: list[Pair]) -> dict:
    """Returns the kept values that conform to the data, by path (HY-17, HY-38), applying each one before the
    next."""
    selected: dict = {}
    for path, value in kept:
        replaced, applied = _replace(data, path.split('.'), value) if contains(value) else (data, False)
        if applied:
            selected[path] = value
        data = replaced
    return selected


def _replace(container, keys: list[str], value) -> tuple[object, bool]:
    """Returns the container with the value at the path of keys replaced when it conforms, and whether it replaced
    the value; an absent path changes nothing."""
    if isinstance(container, dict):
        key = keys[0]
        if key not in container:
            return container, False
        rest = keys[1:]
        copy = dict(container)
        if not rest:
            if _conforms(value, copy[key]):
                copy[key] = value
                return copy, True
            return container, False
        copy[key], applied = _replace(copy[key], rest, value)
        return copy, applied
    if isinstance(container, list):
        if re.fullmatch(r'\d+', keys[0]) is None:
            return container, False
        index = int(keys[0])
        if index >= len(container):
            return container, False
        rest = keys[1:]
        copy = list(container)
        if not rest:
            if _conforms(value, copy[index]):
                copy[index] = value
                return copy, True
            return container, False
        copy[index], applied = _replace(copy[index], rest, value)
        return copy, applied
    return container, False


def _conforms(value, current) -> bool:
    """Returns True when a kept value has the shape of the data value (HY-38): the same type, the same keys of a map
    with conforming values, and list items that conform to the first data item. An empty map or list gives no
    shape."""
    if _kind(current) != _kind(value):
        return False
    if isinstance(current, dict) and isinstance(value, dict):
        if current == {}:
            return True
        if len(value) != len(current):
            return False
        return all(key in value and _conforms(value[key], item) for key, item in current.items())
    if isinstance(current, list) and current != [] and isinstance(value, list):
        return all(_conforms(item, current[0]) for item in value)
    return True


def _kind(value) -> str:
    """Returns the value type of the data model: null, bool, number, string, list or map."""
    if value is None:
        return 'null'
    if isinstance(value, bool):
        return 'bool'
    if isinstance(value, (int, float)):
        return 'number'
    if isinstance(value, str):
        return 'string'
    if isinstance(value, list):
        return 'list'
    if isinstance(value, dict):
        return 'map'
    return 'other'
