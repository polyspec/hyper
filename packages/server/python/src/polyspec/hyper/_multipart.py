"""Reads a ``multipart/form-data`` body (HY-57, HY-113): a part whose ``Content-Disposition`` is ``form-data`` with a
``name`` and no ``filename`` is a text field, a part with a ``name`` and a ``filename`` is a file, and a part without a
name is neither. The header lines of a part are separated by CRLF, and blanks are spaces and tabs (HY-113.12, HY-113.13)."""

from __future__ import annotations

import re
from typing import Optional

# Fields and Files read a body through this module, so it reaches them as modules, which a cycle allows.
from . import _fields, _files
from .uploaded_file import UploadedFile


# re.ASCII keeps the case folding to ASCII, as the byte patterns of PHP and the patterns of Node fold it.
class Multipart:
    """Reads the parts of a ``multipart/form-data`` body."""

    _MULTIPART = re.compile(r"multipart/form-data[ \t]*;", re.IGNORECASE | re.ASCII)
    _BOUNDARY = re.compile(
        r';[ \t]*boundary=(?:"([^"]+)"|([^; \t]+))', re.IGNORECASE | re.ASCII
    )
    _NAME = re.compile(r';[ \t]*name="([^"]*)"', re.IGNORECASE | re.ASCII)
    _FILENAME = re.compile(
        r';[ \t]*filename=(?:"([^"]*)"|([^; \t]*))', re.IGNORECASE | re.ASCII
    )
    # The largest header of a part in bytes (HY-113.16).
    _HEADER_LIMIT = 8192

    @staticmethod
    def boundary(content_type: str) -> Optional[str]:
        """Returns the boundary of a ``multipart/form-data`` content type, or None for another type (HY-57, HY-113)."""
        if Multipart._MULTIPART.match(content_type) is None:
            return None
        found = Multipart._BOUNDARY.search(content_type)
        if found is None:
            return None
        return found.group(1) if found.group(1) is not None else found.group(2)

    @staticmethod
    def read(
        body: bytes, boundary: str
    ) -> Optional[tuple[_fields.Fields, _files.Files]]:
        """Returns the text fields and the files of the body, or None when a name, a value, a filename or a content type
        is not UTF-8 (HY-42, HY-113)."""
        delimiter = b"--" + boundary.encode("latin-1")
        names: list[str] = []
        values: dict[str, list[str]] = {}
        file_names: list[str] = []
        files: dict[str, list[UploadedFile]] = {}
        start = body.find(delimiter)
        while start >= 0:
            part_start = start + len(delimiter)
            if body[part_start : part_start + 2] == b"--":
                break
            next_start = body.find(delimiter, part_start)
            if next_start < 0:
                break
            part = body[part_start + 2 : next_start - 2]
            header_end = part.find(b"\r\n\r\n")
            start = next_start
            if (len(part) if header_end < 0 else header_end) > Multipart._HEADER_LIMIT:
                return None
            if header_end < 0:
                continue
            lines = part[:header_end].decode("latin-1").split("\r\n")
            content = part[header_end + 4 :]
            disposition = Multipart._header_value(lines, "content-disposition")
            if disposition is None or disposition[:9].lower() != "form-data":
                continue
            parameters = disposition[9:]
            found = Multipart._NAME.search(parameters)
            if found is None:
                continue
            name = Multipart._utf8_text(found.group(1).encode("latin-1"))
            if name is None:
                return None
            filename = Multipart._FILENAME.search(parameters)
            if filename is None:
                value = Multipart._utf8_text(content)
                if value is None:
                    return None
                Multipart._add_value(names, values, name, value)
            else:
                # A quoted filename keeps its backslashes; a token is the text as it is (HY-113.14).
                raw = (
                    filename.group(1)
                    if filename.group(1) is not None
                    else filename.group(2) or ""
                )
                text = Multipart._utf8_text(raw.encode("latin-1"))
                kind = Multipart._utf8_text(
                    (Multipart._header_value(lines, "content-type") or "").encode(
                        "latin-1"
                    )
                )
                if text is None or kind is None:
                    return None
                Multipart._add_value(
                    file_names, files, name, UploadedFile(name, text, kind, content)
                )
        return _fields.Fields(names, values), _files.Files(file_names, files)

    @staticmethod
    def _header_value(lines: list[str], name: str) -> Optional[str]:
        """Returns the value of the first header line of the name, compared without case, without the spaces and tabs
        around it, or None when no line has the name."""
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
