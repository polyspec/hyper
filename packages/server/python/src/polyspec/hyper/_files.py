"""The file parts of a multipart body: each name, in the order of its first occurrence, with its files in request
order (HY-113)."""

from __future__ import annotations

from typing import Optional

from . import _multipart
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
        """Returns the files of a ``multipart/form-data`` body, and none for another body type. Returns None when a
        part of the body fails with HY-42 (HY-113.15)."""
        boundary = _multipart.Multipart.boundary(content_type)
        if boundary is None:
            return Files.empty()
        parts = _multipart.Multipart.read(body, boundary)
        return None if parts is None else parts[1]

    def largest(self) -> int:
        """Returns the size in bytes of the largest file, or 0 when there is none (HY-114)."""
        return max(
            (len(item.content()) for _, files in self.pairs() for item in files),
            default=0,
        )
