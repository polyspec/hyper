"""The file parts of a multipart body: each name, in the order of its first occurrence, with its files in request
order (HY-113)."""

from __future__ import annotations

from ._named_values import NamedValues
from .uploaded_file import UploadedFile


class Files(NamedValues[UploadedFile]):
    """The files of a multipart body by name."""

    @staticmethod
    def empty() -> Files:
        """Returns files without names."""
        return Files([], {})

    def sizes(self) -> list[int]:
        """Returns the size in bytes of each file, in the order of the pairs (HY-114)."""
        return [item.size() for _, files in self.pairs() for item in files]
