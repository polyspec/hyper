"""The cookies of a request: one parse of its `Cookie` lines (HY-129), the same in every server, by `parse_cookie`
of http-cookie in the core (HY-129.13)."""

from __future__ import annotations


class Cookies:
    @staticmethod
    def parse(lines: list[str]) -> dict[str, str]:
        """Returns the cookies of the field values of the `Cookie` lines of a request in their order, by name, with
        rules.parse_cookie of the core. Each line is text with one character per byte; a request without the field
        has no line and no cookie."""
        from .._binding import _root

        return dict(_root.parse_cookie(lines))
