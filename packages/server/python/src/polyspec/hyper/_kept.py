"""Kept values (HY-37, HY-38). Values outside the template data model are ignored; the cases of contracts/keep.json
hold the rules."""

from __future__ import annotations

import re
from typing import Optional

from ._data_model import contains

KINDS = ("server", "cookie", "localStorage", "sessionStorage")


class Kept:
    @staticmethod
    def apply(data: dict, kept: list[tuple[str, object]]) -> dict:
        """Replaces values at kept paths when the path exists and the kept value conforms to its value."""
        for path, value in kept:
            if contains(value):
                replaced = Kept._replace_at(data, path.split("."), value)[0]
                data = replaced if isinstance(replaced, dict) else data
        return data

    @staticmethod
    def select(data: dict, kept: list[tuple[str, object]]) -> dict:
        """Returns the kept values that conform to the data, by path (HY-17, HY-38), applying each one before the
        next."""
        selected: dict = {}
        for path, value in kept:
            if not contains(value):
                continue
            replaced, applied = Kept._replace_at(data, path.split("."), value)
            if applied:
                selected[path] = value
            data = replaced if isinstance(replaced, dict) else data
        return selected

    @staticmethod
    def _replace_at(
        container: object, keys: list[str], value: object
    ) -> tuple[object, bool]:
        """Returns the container with the value at the path of keys replaced when it conforms, and whether it
        replaced the value; an absent path changes nothing. A list accepts only an index."""
        key = keys[0] if keys else ""
        rest = keys[1:]
        if isinstance(container, dict):
            if key not in container:
                return container, False
            copy = dict(container)
            if not rest:
                if not Kept._conforms(value, copy[key]):
                    return container, False
                copy[key] = value
                return copy, True
            copy[key], applied = Kept._replace_at(copy[key], rest, value)
            return copy, applied
        if not isinstance(container, list) or re.fullmatch(r"\d+", key) is None:
            return container, False
        index = int(key)
        if index >= len(container):
            return container, False
        items = list(container)
        if not rest:
            if not Kept._conforms(value, items[index]):
                return container, False
            items[index] = value
            return items, True
        items[index], applied = Kept._replace_at(items[index], rest, value)
        return items, applied

    @staticmethod
    def _conforms(value: object, current: object) -> bool:
        """Returns True when a kept value has the shape of the data value (HY-38): the same type, the same keys of a
        map with conforming values, and list items that conform to the first data item. An empty map or list gives
        no shape."""
        if Kept._value_kind(current) != Kept._value_kind(value):
            return False
        data = Kept._map_entries(current)
        kept = Kept._map_entries(value)
        if data is not None and kept is not None:
            if not data:
                return True
            if len(kept) != len(data):
                return False
            return all(
                key in kept and Kept._conforms(kept[key], item)
                for key, item in data.items()
            )
        if isinstance(current, list) and current and isinstance(value, list):
            return all(Kept._conforms(item, current[0]) for item in value)
        return True

    @staticmethod
    def _map_entries(value: object) -> Optional[dict]:
        """Returns the entries of a map of the data model, or None for another value."""
        return value if isinstance(value, dict) else None

    @staticmethod
    def _value_kind(value: object) -> str:
        """Returns the value type of the data model: null, bool, number, string, list or map."""
        if value is None:
            return "null"
        if isinstance(value, bool):
            return "bool"
        if isinstance(value, (int, float)):
            return "number"
        if isinstance(value, str):
            return "string"
        if isinstance(value, list):
            return "list"
        if isinstance(value, dict):
            return "map"
        return "other"
