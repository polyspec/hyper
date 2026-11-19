"""The values of a query or a form, without nesting: each name, in the order of its first occurrence, with its values
in request order; a bracketed name is the name as written (HY-56, HY-57)."""

from __future__ import annotations

from typing import Optional

from ..app._core_rules import CoreRules
from ._named_values import NamedValues


class Fields(NamedValues[str]):
    """The values of a query string or a form body."""

    @staticmethod
    def empty() -> Fields:
        """Returns fields without names."""
        return Fields([], {})

    @staticmethod
    def parse(text: bytes) -> Optional[Fields]:
        """Parses ``name=value&name=value`` through the core (form_functions.parse_urlencoded): ``+`` is a space,
        ``%XX`` is its byte and another ``%`` stays. Returns None when a name or a value is not UTF-8 (HY-42, HY-56)."""
        try:
            pairs = CoreRules.shared().form_parse_urlencoded(text)
        except ValueError:
            return None
        return Fields(
            [name for name, _ in pairs], {name: list(values) for name, values in pairs}
        )
