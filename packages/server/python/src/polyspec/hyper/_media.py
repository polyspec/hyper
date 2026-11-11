"""The selection of the media type of a request among the candidate types by its `Accept` ranges (HY-116, HY-119).

Each candidate takes the weight of its most specific matching range: the range that names the type, then `type/*`,
then `*/*`. Among the ranges of that specificity the highest weight counts. The candidate of the highest weight is
selected, and among equal weights the first candidate of the order given."""

from __future__ import annotations

from typing import Optional, Sequence

from ._accept import Range

TEXT_HTML = "text/html"
JSON = "application/vnd.hyper+json"


def select(ranges: Sequence[Range], candidates: Sequence[str]) -> Optional[str]:
    """Returns the candidate of the highest weight, or None when no candidate has a weight above 0."""
    chosen: Optional[str] = None
    best = 0
    for candidate in candidates:
        weight = _weight(ranges, candidate)
        if weight is not None and weight > best:
            chosen, best = candidate, weight
    return chosen


def _weight(ranges: Sequence[Range], candidate: str) -> Optional[int]:
    """Returns the weight of a candidate type, or None when no range matches it."""
    kind, _, subtype = candidate.partition("/")
    best_specificity = 0
    weight: Optional[int] = None
    for item in ranges:
        specificity = _specificity(item, kind, subtype)
        if specificity == 0:
            continue
        if specificity > best_specificity:
            best_specificity, weight = specificity, item.weight
        elif specificity == best_specificity and weight is not None:
            weight = max(weight, item.weight)
    return weight


def _specificity(item: Range, kind: str, subtype: str) -> int:
    """Returns 3 for a range that names the type, 2 for `type/*`, 1 for `*/*` and 0 for a range that does not match.
    Parameters do not change the specificity of a range that names one of the candidate types (HY-116)."""
    if item.type == "*":
        return 1
    if item.type != kind:
        return 0
    if item.subtype == subtype:
        return 3
    if item.subtype == "*":
        return 2
    return 0
