"""The error of an `Accept` value that the grammar does not allow (HY-116)."""

from __future__ import annotations


class InvalidAccept(ValueError):
    """An `Accept` value that does not follow the grammar of RFC 9110, section 12.5.1, or that has a weight that is
    not a qvalue; the server answers it with status 400 (HY-116.5)."""
