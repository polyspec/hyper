"""Query and form values, without nesting: an ordered map from each name, in the order of its first occurrence, to
its values in request order (HY-56, HY-57). A bracketed name is the name as written. The PHP and the JavaScript
implementation pass the same cases of conformance/fields.json."""

from __future__ import annotations

import re
from typing import Iterator, Optional

_URLENCODED = re.compile(r'application/x-www-form-urlencoded\s*(;|$)', re.IGNORECASE)
_MULTIPART = re.compile(r'multipart/form-data\s*;', re.IGNORECASE)
_BOUNDARY = re.compile(r';\s*boundary=(?:"([^"]*)"|([^;\s]+))', re.IGNORECASE)
_DISPOSITION = re.compile(r'^content-disposition:\s*form-data(.*)$', re.IGNORECASE | re.MULTILINE)
_NAME = re.compile(r';\s*name="([^"]*)"', re.IGNORECASE)
_FILENAME = re.compile(r';\s*filename=', re.IGNORECASE)
_HEX = re.compile(rb'[0-9A-Fa-f]{2}')


class Fields:
    """The values of a query string or a form body."""

    def __init__(self, names: list[str], values: dict[str, list[str]]):
        self._names = names
        self._values = values

    @staticmethod
    def empty() -> 'Fields':
        """Returns fields without names."""
        return Fields([], {})

    @staticmethod
    def parse(text: bytes) -> Optional['Fields']:
        """Parses ``name=value&name=value``: ``+`` is a space, ``%XX`` is its byte and another ``%`` stays. Returns
        None when a name or a value is not UTF-8 (HY-42, HY-56)."""
        names: list[str] = []
        values: dict[str, list[str]] = {}
        for part in text.split(b'&'):
            if part == b'':
                continue
            equals = part.find(b'=')
            name = _decode(part if equals < 0 else part[:equals])
            value = _decode(b'' if equals < 0 else part[equals + 1:])
            if name is None or value is None:
                return None
            if name not in values:
                names.append(name)
                values[name] = []
            values[name].append(value)
        return Fields(names, values)

    @staticmethod
    def from_body(content_type: str, body: bytes) -> Optional['Fields']:
        """Returns the fields of a request body: of an ``application/x-www-form-urlencoded`` body, or the text fields
        of a ``multipart/form-data`` body; a body of another type has none (HY-57). Returns None when a name or a
        value is not UTF-8 (HY-42)."""
        if _URLENCODED.match(content_type) is not None:
            return Fields.parse(body)
        found = _MULTIPART.match(content_type)
        boundary = found and _BOUNDARY.search(content_type)
        if boundary is not None:
            return _multipart(body, boundary.group(1) or boundary.group(2))
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
        elif byte == 0x25 and _HEX.fullmatch(text[index + 1:index + 3]) is not None:  # '%'
            decoded.append(int(text[index + 1:index + 3], 16))
            index += 3
        else:
            decoded.append(byte)
            index += 1
    try:
        return bytes(decoded).decode('utf-8')
    except UnicodeDecodeError:
        return None


def _multipart(body: bytes, boundary: str) -> Optional[Fields]:
    """Reads the text fields of a multipart/form-data body; a file field is not a form value (HY-57)."""
    delimiter = b'--' + boundary.encode('latin-1')
    names: list[str] = []
    values: dict[str, list[str]] = {}
    start = body.find(delimiter)
    while start >= 0:
        part_start = start + len(delimiter)
        if body[part_start:part_start + 2] == b'--':
            break
        next_start = body.find(delimiter, part_start)
        if next_start < 0:
            break
        part = body[part_start + 2:next_start - 2]
        header_end = part.find(b'\r\n\r\n')
        if header_end >= 0:
            headers = part[:header_end].decode('latin-1')
            found = _DISPOSITION.search(headers)
            disposition = found.group(1).rstrip('\r') if found else ''
            name = _NAME.search(disposition)
            if name is not None and _FILENAME.search(disposition) is None:
                value = _as_utf8(part[header_end + 4:])
                key = _as_utf8(name.group(1).encode('latin-1'))
                if value is None or key is None:
                    return None
                if key not in values:
                    names.append(key)
                    values[key] = []
                values[key].append(value)
        start = next_start
    return Fields(names, values)


def _as_utf8(text: bytes) -> Optional[str]:
    try:
        return text.decode('utf-8')
    except UnicodeDecodeError:
        return None
