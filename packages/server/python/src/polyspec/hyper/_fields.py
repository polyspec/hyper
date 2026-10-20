"""Query and form values, without nesting: an ordered map from each name, in the order of its first occurrence, to
its values in request order (HY-56, HY-57). A bracketed name is the name as written. The PHP and the JavaScript
implementation pass the same cases of contracts/fields.json."""

from __future__ import annotations

import re
from typing import Iterator, Optional

from .uploaded_file import UploadedFile

_URLENCODED = re.compile(r"application/x-www-form-urlencoded\s*(;|$)", re.IGNORECASE)
_MULTIPART = re.compile(r"multipart/form-data\s*;", re.IGNORECASE)
_BOUNDARY = re.compile(r';\s*boundary=(?:"([^"]*)"|([^;\s]+))', re.IGNORECASE)
_DISPOSITION = re.compile(
    r"^content-disposition:\s*form-data(.*)$", re.IGNORECASE | re.MULTILINE
)
_NAME = re.compile(r';\s*name="([^"]*)"', re.IGNORECASE)
_FILENAME = re.compile(r";\s*filename=", re.IGNORECASE)
# The filename parameter: a quoted string, whose backslash escapes are undone by _filename, or a token.
_FILENAME_VALUE = re.compile(
    r';\s*filename=(?:"((?:[^"\\]|\\.)*)"|([^;\s]*))', re.IGNORECASE
)
_CONTENT_TYPE = re.compile(r"^content-type:[ \t]*(.*?)\r?$", re.IGNORECASE | re.MULTILINE)
_HEX = re.compile(rb"[0-9A-Fa-f]{2}")


class Fields:
    """The values of a query string or a form body."""

    def __init__(self, names: list[str], values: dict[str, list[str]]):
        self._names = names
        self._values = values

    @staticmethod
    def empty() -> "Fields":
        """Returns fields without names."""
        return Fields([], {})

    @staticmethod
    def parse(text: bytes) -> Optional["Fields"]:
        """Parses ``name=value&name=value``: ``+`` is a space, ``%XX`` is its byte and another ``%`` stays. Returns
        None when a name or a value is not UTF-8 (HY-42, HY-56)."""
        names: list[str] = []
        values: dict[str, list[str]] = {}
        for part in text.split(b"&"):
            if part == b"":
                continue
            equals = part.find(b"=")
            name = _decode(part if equals < 0 else part[:equals])
            value = _decode(b"" if equals < 0 else part[equals + 1 :])
            if name is None or value is None:
                return None
            if name not in values:
                names.append(name)
                values[name] = []
            values[name].append(value)
        return Fields(names, values)

    @staticmethod
    def from_body(content_type: str, body: bytes) -> Optional["Fields"]:
        """Returns the fields of a request body: of an ``application/x-www-form-urlencoded`` body, or the text fields
        of a ``multipart/form-data`` body; a body of another type has none (HY-57). Returns None when a name or a
        value is not UTF-8 (HY-42)."""
        if _URLENCODED.match(content_type) is not None:
            return Fields.parse(body)
        found = _MULTIPART.match(content_type)
        boundary = found and _BOUNDARY.search(content_type)
        if boundary is not None:
            parts = _multipart(body, boundary.group(1) or boundary.group(2))
            return None if parts is None else parts[0]
        return Fields.empty()

    def names(self) -> list[str]:
        """Returns the names in the order of their first occurrence."""
        return list(self._names)

    def has(self, name: str) -> bool:
        """Returns True when the name has a value."""
        return name in self._values

    def get(self, name: str) -> list[str]:
        """Returns the values of a name in request order; an absent name has none."""
        return list(self._values.get(name, []))

    def last(self, name: str) -> Optional[str]:
        """Returns the last value of a name, or None."""
        values = self._values.get(name)
        return values[-1] if values else None

    def __iter__(self) -> Iterator[tuple[str, list[str]]]:
        return iter((name, list(self._values[name])) for name in self._names)

    def __len__(self) -> int:
        return len(self._names)


def _decode(text: bytes) -> Optional[str]:
    """Decodes ``+`` to a space and ``%XX`` to its byte, then the bytes as UTF-8, or None when they are not UTF-8."""
    decoded = bytearray()
    index = 0
    while index < len(text):
        byte = text[index]
        if byte == 0x2B:  # '+'
            decoded.append(0x20)
            index += 1
        elif (
            byte == 0x25 and _HEX.fullmatch(text[index + 1 : index + 3]) is not None
        ):  # '%'
            decoded.append(int(text[index + 1 : index + 3], 16))
            index += 3
        else:
            decoded.append(byte)
            index += 1
    try:
        return bytes(decoded).decode("utf-8")
    except UnicodeDecodeError:
        return None


def _multipart(
    body: bytes, boundary: str
) -> Optional[tuple["Fields", "Files"]]:
    """Reads the text fields and the file parts of a multipart/form-data body (HY-57, HY-113). A part with a name and
    a filename is a file; a part without a name is neither. Returns None when a name, a value, a filename or a content
    type is not UTF-8."""
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
        if header_end >= 0:
            headers = part[:header_end].decode("latin-1")
            found = _DISPOSITION.search(headers)
            disposition = found.group(1).rstrip("\r") if found else ""
            name = _NAME.search(disposition)
            content = part[header_end + 4 :]
            if name is not None and _FILENAME.search(disposition) is None:
                value = _as_utf8(content)
                key = _as_utf8(name.group(1).encode("latin-1"))
                if value is None or key is None:
                    return None
                if key not in values:
                    names.append(key)
                    values[key] = []
                values[key].append(value)
            elif name is not None:
                key = _as_utf8(name.group(1).encode("latin-1"))
                filename = _filename(disposition)
                kind = _content_type(headers)
                if key is None or filename is None or kind is None:
                    return None
                if key not in files:
                    file_names.append(key)
                    files[key] = []
                files[key].append(UploadedFile(key, filename, kind, content))
        start = next_start
    return Fields(names, values), Files(file_names, files)


def _filename(disposition: str) -> Optional[str]:
    """Returns the filename parameter with the backslash escapes of its quoted string undone, or a token as it is,
    decoded as UTF-8; None when it is not UTF-8."""
    found = _FILENAME_VALUE.search(disposition)
    if found is None:
        return None
    raw = found.group(1) if found.group(1) is not None else found.group(2)
    text = re.sub(r"\\(.)", r"\1", raw)
    return _as_utf8(text.encode("latin-1"))


def _content_type(headers: str) -> Optional[str]:
    """Returns the value of the Content-Type header of a part as sent, or the empty text, decoded as UTF-8; None when
    it is not UTF-8."""
    found = _CONTENT_TYPE.search(headers)
    if found is None:
        return ""
    return _as_utf8(found.group(1).strip().encode("latin-1"))


class Files:
    """The file parts of a multipart body: an ordered map from each name to its files in request order (HY-113)."""

    def __init__(self, names: list[str], values: dict[str, list["UploadedFile"]]):
        self._names = names
        self._values = values

    @staticmethod
    def empty() -> "Files":
        """Returns files without names."""
        return Files([], {})

    @staticmethod
    def from_body(content_type: str, body: bytes) -> Optional["Files"]:
        """Returns the files of a multipart/form-data body, and none for another body type. Returns None when a name,
        a filename or a content type is not UTF-8 (HY-42, HY-113)."""
        found = _MULTIPART.match(content_type)
        boundary = found and _BOUNDARY.search(content_type)
        if boundary is not None:
            parts = _multipart(body, boundary.group(1) or boundary.group(2))
            return None if parts is None else parts[1]
        return Files.empty()

    def names(self) -> list[str]:
        """Returns the names in the order of their first occurrence."""
        return list(self._names)

    def get(self, name: str) -> list["UploadedFile"]:
        """Returns the files of a name in request order; an absent name has none."""
        return list(self._values.get(name, []))

    def last(self, name: str) -> Optional["UploadedFile"]:
        """Returns the last file of a name, or None."""
        values = self._values.get(name)
        return values[-1] if values else None

    def largest(self) -> int:
        """Returns the size in bytes of the largest file, or 0 when there is none."""
        return max((len(item.content) for values in self._values.values() for item in values), default=0)


def _as_utf8(text: bytes) -> Optional[str]:
    try:
        return text.decode("utf-8")
    except UnicodeDecodeError:
        return None
