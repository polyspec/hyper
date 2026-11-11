"""Reads the parts of a ``multipart/form-data`` body (HY-57, HY-113): a part whose ``Content-Disposition`` is
``form-data`` with a ``name`` and no ``filename`` is a text field, a part with a ``name`` and a ``filename`` is a file,
and another part is neither."""

from __future__ import annotations

import os
from typing import BinaryIO, Optional

# Fields and Files read a body through this module, so it reaches them as modules, which a cycle allows.
from . import _fields, _files
from ._multipart_reader import MultipartReader
from .uploaded_file import UploadedFile


class Multipart(MultipartReader):
    """Reads the text fields and the files of a ``multipart/form-data`` body."""

    def __init__(
        self,
        boundary: str,
        directory: Optional[str],
        value_limit: Optional[int],
        part_limit: Optional[int],
        file_limit: Optional[int],
    ):
        super().__init__(boundary)
        # The largest bytes of the names and contents of the text values together, the largest number of parts and
        # the largest bytes of one file, each None for no limit (HY-131.7 to HY-131.12), with what was read of each.
        self.__value_limit = value_limit
        self.__part_limit = part_limit
        self.__file_limit = file_limit
        self.__value_bytes = 0
        self.__part_count = 0
        self.__over = False
        # The directory of the files of the body, or None for files that are values (HY-131.13).
        self.__directory = directory
        # The file that the content of the file part is written to, with its path and the bytes given to it.
        self.__target: Optional[BinaryIO] = None
        self.__path = ""
        self.__size = 0
        self.__stored = 0
        self.__names: list[str] = []
        self.__values: dict[str, list[str]] = {}
        self.__file_names: list[str] = []
        self.__files: dict[str, list[UploadedFile]] = {}
        # The name of the part that is read, or None for a part that is neither a value nor a file (HY-113.6).
        self.__name: Optional[str] = None
        # The filename and the content type of the file part that is read, or None for a text field.
        self.__file: Optional[tuple[str, str]] = None
        self.__content: list[bytes] = []

    @staticmethod
    def boundary(content_type: str) -> Optional[str]:
        """Returns the boundary of a ``multipart/form-data`` content type, or None for another type (HY-113.11)."""
        kind, parameters = Multipart._header_parameters(content_type)
        boundary = parameters.get("boundary", "")
        return None if kind != "multipart/form-data" or boundary == "" else boundary

    @staticmethod
    def read(
        body: bytes, boundary: str
    ) -> Optional[tuple[_fields.Fields, _files.Files]]:
        """Returns the text fields and the files of the body, or None when the body fails with HY-42 (HY-113,
        HY-131)."""
        reader = Multipart(boundary, None, None, None, None)
        return reader.result() if reader.feed(body) else None

    def result(self) -> Optional[tuple[_fields.Fields, _files.Files]]:
        """Returns the text fields and the files that were read, or None for a body that failed or has not ended
        (HY-131.5)."""
        if not self.closed():
            return None
        return (
            _fields.Fields(self.__names, self.__values),
            _files.Files(self.__file_names, self.__files),
        )

    def exceeded(self) -> bool:
        """Returns True when the body passed the value limit, the part limit or the file limit (HY-131.11)."""
        return self.__over

    def count(self) -> int:
        """Returns the number of parts that were read, also those that are neither a value nor a file
        (HY-131.12)."""
        return self.__part_count

    def part_started(self, lines: list[str]) -> bool:
        self.__name = None
        self.__file = None
        self.__content = []
        self.__part_count += 1
        if self.__part_limit is not None and self.__part_count > self.__part_limit:
            return self._limit_passed()
        disposition = Multipart._header_value(lines, "content-disposition")
        if disposition is None:
            return True
        kind, parameters = Multipart._header_parameters(disposition)
        if kind != "form-data" or "name" not in parameters:
            return True
        if "filename" in parameters:
            text = Multipart._utf8_text(parameters["filename"].encode("latin-1"))
            content_type = Multipart._utf8_text(
                (Multipart._header_value(lines, "content-type") or "").encode("latin-1")
            )
            if text is None or content_type is None:
                return False
            self.__file = (text, content_type)
        self.__name = Multipart._utf8_text(parameters["name"].encode("latin-1"))
        if self.__name is None:
            return False
        self.__size = 0
        if self.__file is None:
            # The name counts as its bytes were sent.
            self.__value_bytes += len(parameters["name"])
            if (
                self.__value_limit is not None
                and self.__value_bytes > self.__value_limit
            ):
                return self._limit_passed()
        if self.__file is not None and self.__directory is not None:
            self.__stored += 1
            self.__path = os.path.join(self.__directory, str(self.__stored))
            # O_EXCL fails for a path that exists, and the mode gives the file to the user of the server only.
            self.__target = os.fdopen(
                os.open(self.__path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb"
            )
        return True

    def part_data(self, data: bytes) -> bool:
        if self.__name is None:
            return True
        if self.__file is None:
            self.__value_bytes += len(data)
            if (
                self.__value_limit is not None
                and self.__value_bytes > self.__value_limit
            ):
                return self._limit_passed()
        else:
            self.__size += len(data)
            if self.__file_limit is not None and self.__size > self.__file_limit:
                return self._limit_passed()
        if self.__target is None:
            self.__content.append(data)
        else:
            self.__target.write(data)
        return True

    def _limit_passed(self) -> bool:
        """Records that the body passed a limit, and fails the body."""
        self.__over = True
        self.__content = []
        return False

    def release(self) -> None:
        """Closes the file of a part whose end was not read."""
        if self.__target is not None:
            self.__target.close()
            self.__target = None

    def part_ended(self) -> bool:
        if self.__name is None:
            return True
        content = b"".join(self.__content)
        self.__content = []
        if self.__file is None:
            value = Multipart._utf8_text(content)
            if value is None:
                return False
            Multipart._add_value(self.__names, self.__values, self.__name, value)
        elif self.__target is None:
            uploaded = UploadedFile(
                self.__name, self.__file[0], self.__file[1], content
            )
            Multipart._add_value(self.__file_names, self.__files, self.__name, uploaded)
        else:
            self.__target.close()
            self.__target = None
            uploaded = UploadedFile._stored(
                self.__name, self.__file[0], self.__file[1], self.__path, self.__size
            )
            Multipart._add_value(self.__file_names, self.__files, self.__name, uploaded)
        return True

    @staticmethod
    def _header_parameters(text: str) -> tuple[str, dict[str, str]]:
        """Returns the text before the first ``;`` without the spaces and tabs around it, in lower case, and the
        parameters after it by their names in lower case: each follows a ``;`` and spaces or tabs, its value is a
        quoted string without its quotes or the text up to the next ``;``, space or tab, and the first parameter of a
        name counts (HY-113.13)."""
        parameters: dict[str, str] = {}
        length = len(text)
        index = text.find(";")
        kind = (text if index < 0 else text[:index]).strip(" \t").lower()
        while index >= 0:
            index += 1
            while index < length and text[index] in " \t":
                index += 1
            start = index
            while index < length and text[index] not in "=;":
                index += 1
            if index >= length or text[index] != "=":
                index = index if index < length else -1
                continue
            name = text[start:index].lower()
            index += 1
            if index < length and text[index] == '"':
                close = text.find('"', index + 1)
                value = text[index + 1 : length if close < 0 else close]
                index = length if close < 0 else close + 1
            else:
                start = index
                while index < length and text[index] not in "; \t":
                    index += 1
                value = text[start:index]
            if name not in parameters:
                parameters[name] = value
            index = text.find(";", index)
        return kind, parameters

    @staticmethod
    def _header_value(lines: list[str], name: str) -> Optional[str]:
        """Returns the value of the first header line of the name, compared without case, without the spaces and tabs
        around it, or None when no line has the name (HY-113.12)."""
        for line in lines:
            colon = line.find(":")
            if colon >= 0 and line[:colon].lower() == name:
                return line[colon + 1 :].strip(" \t")
        return None

    @staticmethod
    def _utf8_text(data: bytes) -> Optional[str]:
        """Returns the UTF-8 text of the bytes, or None when they are not UTF-8."""
        try:
            return data.decode("utf-8")
        except UnicodeDecodeError:
            return None

    @staticmethod
    def _add_value(names: list[str], values: dict, name: str, value: object) -> None:
        """Appends a value to its name, and the name to the names at its first value."""
        if name not in values:
            names.append(name)
            values[name] = []
        values[name].append(value)
