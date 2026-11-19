"""The file parts of a multipart body: each name, in the order of its first occurrence, with its files in request
order (HY-113)."""

from __future__ import annotations

from typing import Optional

from ._named_values import NamedValues
from .uploaded_file import UploadedFile


class Files(NamedValues[UploadedFile]):
    """The files of a multipart body by name."""

    @staticmethod
    def empty() -> Files:
        """Returns files without names."""
        return Files([], {})

    @staticmethod
    def from_body(content_type: str, body: bytes) -> Optional[Files]:
        """Returns the files of a ``multipart/form-data`` body held as one value, as the core reads it, and none for another body type. Returns None when a
        part of the body fails with HY-42 (HY-113.15)."""
        from ._core_body import NO_LIMIT, held_form

        form, _, _ = held_form(content_type, body, NO_LIMIT, NO_LIMIT, NO_LIMIT)
        return None if form is None else form[1]

    def sizes(self) -> list[int]:
        """Returns the size in bytes of each file, in the order of the pairs (HY-114)."""
        return [item.size() for _, files in self.pairs() for item in files]
