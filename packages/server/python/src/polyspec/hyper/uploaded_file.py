"""A file part of a multipart/form-data request (HY-113): its name, filename, content type and bytes. The bytes are a
value, or a temporary file of the request for a body that the server read in chunks (HY-131)."""

from __future__ import annotations

import os
import shutil
from typing import Optional


class UploadedFile:
    """A file that a request sent in a file part. Its content is the bytes of the part as they were sent."""

    def __init__(self, name: str, filename: str, content_type: str, content: bytes):
        self.__name = name
        self.__filename = filename
        self.__content_type = content_type
        self.__value: Optional[bytes] = content
        self.__path: Optional[str] = None
        self.__length = len(content)
        self.__moved = False

    @staticmethod
    def _stored(
        name: str, filename: str, content_type: str, path: str, size: int
    ) -> UploadedFile:
        """Returns a file whose bytes are the file of the path, of the size in bytes (HY-131.13)."""
        stored = UploadedFile(name, filename, content_type, b"")
        stored.__value = None
        stored.__path = path
        stored.__length = size
        return stored

    def name(self) -> str:
        """Returns the name of the part, the `name` parameter of its Content-Disposition."""
        return self.__name

    def filename(self) -> str:
        """Returns the filename parameter of the part, as it was sent (HY-113.14)."""
        return self.__filename

    def content_type(self) -> str:
        """Returns the Content-Type header of the part as it was sent, or the empty text when it has none."""
        return self.__content_type

    def size(self) -> int:
        """Returns the number of bytes of the part (HY-131.15)."""
        return self.__length

    def content(self) -> bytes:
        """Returns the bytes of the part as one value, and fails after a move (HY-131.16)."""
        if self.__moved:
            raise ValueError("the file was moved (HY-131)")
        if self.__value is not None:
            return self.__value
        if self.__path is None:
            raise RuntimeError("hyper: a stored file has no path")
        with open(self.__path, "rb") as source:
            return source.read()

    def move_to(self, path: str) -> None:
        """Moves the file to the path, and fails when the path exists or when the file was moved (HY-131.15,
        HY-131.16)."""
        if not isinstance(path, str):
            raise TypeError("a path is not a string (HY-131)")
        if self.__moved:
            raise ValueError("the file was moved (HY-131)")
        if self.__path is None:
            with UploadedFile._created_file(path) as target:
                target.write(self.__value or b"")
        else:
            UploadedFile._linked_file(self.__path, path)
            os.unlink(self.__path)
        self.__value = None
        self.__moved = True

    @staticmethod
    def _created_file(path: str):
        """Opens a new file at the path for writing, and fails when the path exists."""
        try:
            return os.fdopen(
                os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb"
            )
        except FileExistsError:
            raise ValueError("the path exists (HY-131)") from None

    @staticmethod
    def _linked_file(source: str, path: str) -> None:
        """Gives the file of the source the path as a second name, or copies it there when the file system gives no
        second name, as between two file systems; fails when the path exists."""
        try:
            os.link(source, path)
        except FileExistsError:
            raise ValueError("the path exists (HY-131)") from None
        except OSError:
            with (
                open(source, "rb") as origin,
                UploadedFile._created_file(path) as target,
            ):
                shutil.copyfileobj(origin, target)
