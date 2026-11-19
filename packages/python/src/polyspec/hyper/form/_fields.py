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

    @staticmethod
    def from_body(content_type: str, body: bytes) -> Optional[Fields]:
        """Returns the fields of a request body held as one value, as the core reads it: of an
        ``application/x-www-form-urlencoded`` body, or the text fields of a ``multipart/form-data`` body; a body of
        another type has none (HY-57). Returns None when the body fails with ``invalid`` or ``header_limit``
        (HY-42, HY-113.25)."""
        from ._core_body import NO_LIMIT, held_form

        form, _, _ = held_form(content_type, body, NO_LIMIT, NO_LIMIT, NO_LIMIT)
        return None if form is None else form[0]
