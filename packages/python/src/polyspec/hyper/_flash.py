"""Values and changed topics that an action passes to the next request (HY-17, HY-25)."""

from __future__ import annotations


class Flash:
    """Values and changed topics that an action passes to the next request (HY-17, HY-25)."""

    values: dict
    changed: list[str]

    def __init__(self, values: dict, changed: list[str]) -> None:
        self.values = values
        self.changed = changed
