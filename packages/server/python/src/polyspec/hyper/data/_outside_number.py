"""A number of a JSON text that has no value in the data model (HY-38, HY-40, HY-54)."""

from __future__ import annotations


class OutsideNumber:
    """A number of a JSON text that has no value in the data model: a number outside ±(2^53 − 1) or one that is not
    finite."""

    literal: str

    def __init__(self, literal: str) -> None:
        self.literal = literal
