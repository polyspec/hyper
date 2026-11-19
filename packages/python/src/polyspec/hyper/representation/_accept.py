"""The `Accept` field of a request: its ranges, which the core reads (HY-116.17, HY-116.18), and the selection of a
media type by the weights of its ranges (HY-116)."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Optional

from ..app._core_rules import CoreRules
from ._media_range import MediaRange

# The kinds of the core for an `Accept` value that the grammar does not allow or whose weight is not a qvalue; the
# server answers both with status 400 (HY-116.5, HY-116.18).
_INVALID = frozenset({"invalid_accept", "invalid_weight"})


class Accept:
    @staticmethod
    def parse(value: Optional[str]) -> list[MediaRange]:
        """Parses an `Accept` field value into its ranges, in order, with rules.accept_ranges of the core. None is a
        request without `Accept`, which reads as the range that matches every type (HY-116.17). Raises the error of
        the core with the kind `invalid_accept` or `invalid_weight` for a value that the grammar does not allow, or a
        weight that is not a qvalue (HY-116.18)."""
        return [
            MediaRange(
                item.type,
                item.subtype,
                tuple((name, text) for name, text in item.parameters),
                item.weight,
            )
            for item in CoreRules.shared().accept_parse(value)
        ]

    @staticmethod
    def is_invalid(error: BaseException) -> bool:
        """Whether an error is the failure of an `Accept` value that `parse` raises (HY-116.18)."""
        return (
            isinstance(error, ValueError) and getattr(error, "kind", None) in _INVALID
        )

    @staticmethod
    def best(
        ranges: Sequence[MediaRange], types: Sequence[str]
    ) -> tuple[Optional[str], int]:
        """Returns the type of the highest weight among the given types with that weight in thousandths, the first
        on a tie, or None and 0 when no type has a weight above 0 (HY-116)."""
        selected: Optional[str] = None
        best = 0
        for media in types:
            weight = Accept._type_weight(ranges, media)
            if weight > best:
                selected, best = media, weight
        return selected, best

    @staticmethod
    def _type_weight(ranges: Sequence[MediaRange], media: str) -> int:
        """Returns the weight in thousandths that the ranges give a type: the weight of the most specific range that
        matches it, or 0 when no range matches. A range that names the type matches it whatever its parameters
        (HY-116)."""
        name, _, subtype = media.partition("/")
        specificity = 0
        weight = 0
        for item in ranges:
            if item.type == "*":
                match = 1
            elif item.type == name and item.subtype == "*":
                match = 2
            elif item.type == name and item.subtype == subtype:
                match = 3
            else:
                continue
            if match > specificity or (match == specificity and item.weight > weight):
                specificity, weight = match, item.weight
        return weight
