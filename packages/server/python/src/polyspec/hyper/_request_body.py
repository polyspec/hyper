"""The body of a request as its host reads it (HY-59, HY-131): the bytes of a body that is one value, or the parts of
a ``multipart/form-data`` body that is read in chunks, whose files are in a directory of the request."""

from __future__ import annotations

import os
import shutil
import tempfile
from typing import Optional

from ._fields import Fields
from ._files import Files
from ._multipart import Multipart


class RequestBody:
    """Reads the chunks of a request body."""

    def __init__(
        self,
        content_type: str,
        limit: int,
        stream: bool,
        value_limit: int,
        part_limit: int,
        file_limit: int,
    ):
        """Starts the body of the content type with the body limit; ``stream`` tells whether a multipart body is read
        in chunks, which it is when ``multipart/form-data`` is a form type of the application (HY-131.1). The value
        limit bounds a body that is one value and the text values of a body read in chunks, the part limit its parts
        and the file limit each of its files (HY-131.7 to HY-131.12)."""
        boundary = Multipart.boundary(content_type) if stream else None
        self.__limit = limit
        self.__files = None if boundary is None else RequestBody._created_directory()
        self.__multipart = (
            None
            if boundary is None
            else Multipart(boundary, self.__files, value_limit, part_limit, file_limit)
        )
        self.__chunks: list[bytes] = []
        self.__length = 0
        self.__value_limit = value_limit
        self.__over = False

    def feed(self, chunk: bytes) -> bool:
        """Reads the next chunk, and returns False when the body passed a limit, after which it holds no bytes
        (HY-59.4, HY-131.11)."""
        if self.__over:
            return False
        self.__length += len(chunk)
        if self.__length > self.__limit or (
            self.__multipart is None and self.__length > self.__value_limit
        ):
            return self._body_passed()
        if self.__multipart is None:
            self.__chunks.append(chunk)
        elif not self.__multipart.feed(chunk) and self.__multipart.exceeded():
            return self._body_passed()
        return True

    def exceeded(self) -> bool:
        """Returns True when the body passed the body limit, the value limit, the part limit or the file limit
        (HY-131.11)."""
        return self.__over

    def _body_passed(self) -> bool:
        """Records that the body passed a limit and drops what it holds."""
        self.__over = True
        self.__chunks = []
        if self.__multipart is not None:
            self.__multipart.release()
        return False

    def size(self) -> int:
        """Returns the number of bytes that were read."""
        return self.__length

    def held(self) -> bytes:
        """Returns the body as one value: no bytes for a body read in chunks and for a body that passed the limit."""
        return b"".join(self.__chunks)

    def streamed(self) -> bool:
        """Returns True when the body is read in chunks."""
        return self.__multipart is not None

    def parts(self) -> Optional[tuple[Fields, Files]]:
        """Returns the text fields and the files of a body read in chunks, or None when it failed, has not ended or
        passed the limit (HY-131.5)."""
        if self.__multipart is None or self.__over:
            return None
        return self.__multipart.result()

    def directory(self) -> Optional[str]:
        """Returns the directory of the files of the body, or None for a body that is one value."""
        return self.__files

    @staticmethod
    def _created_directory() -> str:
        """Creates a directory below the temporary directory of the system for the user of the server only."""
        return tempfile.mkdtemp(prefix="hyper-")

    def remove(self) -> None:
        """Removes the directory of the files with the files that were not moved (HY-131.14)."""
        if self.__multipart is not None:
            self.__multipart.release()
        if self.__files is not None and os.path.isdir(self.__files):
            shutil.rmtree(self.__files)
