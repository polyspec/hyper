"""One media range of an `Accept` value (RFC 9110, section 12.5.1) (HY-116)."""

from __future__ import annotations


class MediaRange:
    """One media range of an `Accept` value: its type and subtype in lower case (`*` for a wildcard), its parameters
    before `q` as (name, value) pairs in their order with the name in lower case, and its weight in thousandths, 0 to
    1000 (HY-116)."""

    type: str
    subtype: str
    parameters: tuple[tuple[str, str], ...]
    weight: int

    def __init__(
        self,
        type: str,
        subtype: str,
        parameters: tuple[tuple[str, str], ...],
        weight: int,
    ) -> None:
        self.type = type
        self.subtype = subtype
        self.parameters = parameters
        self.weight = weight
