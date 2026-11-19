"""A file part of a multipart/form-data request (HY-113): its name, filename, content type and bytes. The class of hyper
holds a file of the core (H35.11): its bytes are a value, or a temporary file of the request for a body that the server
read in chunks (HY-131), and the core reads and moves it through http-form (F-11)."""

from __future__ import annotations

from typing import Any


class UploadedFile:
    """A file that a request sent in a file part. Its content is the bytes of the part as they were sent."""

    def __init__(self, name: str, filename: str, content_type: str, content: bytes):
        from .._binding import _root

        # form_file.new gives a file of the core that holds its bytes as a value (F-22).
        self.__core = _root.FormFile(name, filename, content_type, content)

    @staticmethod
    def _of_core(core: Any) -> UploadedFile:
        """Returns the file of hyper over a file that the core read (HY-131.28)."""
        file = UploadedFile.__new__(UploadedFile)
        file.__core = core
        return file

    def name(self) -> str:
        """Returns the name of the part, the `name` parameter of its Content-Disposition."""
        return self.__core.name

    def filename(self) -> str:
        """Returns the filename parameter of the part, as it was sent (HY-113.21)."""
        return self.__core.filename

    def content_type(self) -> str:
        """Returns the Content-Type header of the part as it was sent, or the empty text when it has none."""
        return self.__core.content_type

    def size(self) -> int:
        """Returns the number of bytes of the part (HY-131.28)."""
        return self.__core.size

    def content(self) -> bytes:
        """Returns the bytes of the part as one value, and fails with `moved` after a move (HY-131.28)."""
        return bytes(self.__core.content())

    def move_to(self, path: str) -> None:
        """Moves the file to the path, and fails with `exists` when the path exists and with `moved` when the file was
        moved (HY-131.28)."""
        if not isinstance(path, str):
            raise TypeError("a path is not a string (F-11)")
        self.__core.move_to(path)
