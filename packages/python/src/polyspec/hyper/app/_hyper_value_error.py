"""An error of the category `value` (HY-132.2)."""

from __future__ import annotations


class HyperValueError(ValueError):
    """An error of the category `value` (HY-132.2): it gives its kind, which a caller tells failures apart by, and no
    status."""

    def __init__(self, kind: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind
        self.status: int | None = None
