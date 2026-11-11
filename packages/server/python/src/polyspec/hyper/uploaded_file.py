"""A file part of a multipart/form-data request (HY-113): its name, filename, content type and bytes."""

from __future__ import annotations


class UploadedFile:
    """A file that a request sent in a file part. Its content is the bytes of the part as they were sent."""

    def __init__(self, name: str, filename: str, content_type: str, content: bytes):
        self.__name = name
        self.__filename = filename
        self.__content_type = content_type
        self.__content = content

    def name(self) -> str:
        """Returns the name of the part, the `name` parameter of its Content-Disposition."""
        return self.__name

    def filename(self) -> str:
        """Returns the filename parameter of the part, with the escapes of its quoted string undone."""
        return self.__filename

    def content_type(self) -> str:
        """Returns the Content-Type header of the part as it was sent, or the empty text when it has none."""
        return self.__content_type

    def content(self) -> bytes:
        """Returns the bytes of the part."""
        return self.__content
