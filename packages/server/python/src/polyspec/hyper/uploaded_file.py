"""A file part of a multipart/form-data request (HY-113): its name, filename, content type and bytes."""

from __future__ import annotations


class UploadedFile:
    """A file that a request sent in a file part. Its content is the bytes of the part as they were sent."""

    def __init__(self, name: str, filename: str, content_type: str, content: bytes):
        self._name = name
        self._filename = filename
        self._content_type = content_type
        self._content = content

    @property
    def name(self) -> str:
        """The name of the part, the `name` parameter of its Content-Disposition."""
        return self._name

    @property
    def filename(self) -> str:
        """The filename parameter of the part, with the escapes of its quoted string undone."""
        return self._filename

    @property
    def content_type(self) -> str:
        """The Content-Type header of the part as it was sent, or the empty text when it has none."""
        return self._content_type

    @property
    def content(self) -> bytes:
        """The bytes of the part."""
        return self._content
