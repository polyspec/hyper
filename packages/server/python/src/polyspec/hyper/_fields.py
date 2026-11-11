"""The values of a query or a form, without nesting: each name, in the order of its first occurrence, with its values
in request order; a bracketed name is the name as written (HY-56, HY-57)."""

from __future__ import annotations

import re
from typing import Optional

from . import _multipart
from ._named_values import NamedValues

_URLENCODED = re.compile(
    r"application/x-www-form-urlencoded[ \t]*(;|\Z)", re.IGNORECASE
)
_HEX = re.compile(rb"[0-9A-Fa-f]{2}")


class Fields(NamedValues[str]):
    """The values of a query string or a form body."""

    @staticmethod
    def empty() -> Fields:
        """Returns fields without names."""
        return Fields([], {})

    @staticmethod
    def parse(text: bytes) -> Optional[Fields]:
        """Parses ``name=value&name=value``: ``+`` is a space, ``%XX`` is its byte and another ``%`` stays. Returns
        None when a name or a value is not UTF-8 (HY-42, HY-56)."""
        names: list[str] = []
        values: dict[str, list[str]] = {}
        for part in text.split(b"&"):
            if part == b"":
                continue
            equals = part.find(b"=")
            name = Fields._percent_decoded(part if equals < 0 else part[:equals])
            value = Fields._percent_decoded(b"" if equals < 0 else part[equals + 1 :])
            if name is None or value is None:
                return None
            if name not in values:
                names.append(name)
                values[name] = []
            values[name].append(value)
        return Fields(names, values)

    @staticmethod
    def from_body(content_type: str, body: bytes) -> Optional[Fields]:
        """Returns the fields of a request body: of an ``application/x-www-form-urlencoded`` body, or the text fields
        of a ``multipart/form-data`` body; a body of another type has none (HY-57). Returns None when a part of the
        body fails with HY-42 (HY-113.15)."""
        if _URLENCODED.match(content_type) is not None:
            return Fields.parse(body)
        boundary = _multipart.Multipart.boundary(content_type)
        if boundary is None:
            return Fields.empty()
        parts = _multipart.Multipart.read(body, boundary)
        return None if parts is None else parts[0]

    @staticmethod
    def _percent_decoded(text: bytes) -> Optional[str]:
        """Decodes ``+`` to a space and ``%XX`` to its byte, as PHP urldecode does, and the bytes as UTF-8, or None
        when they are not UTF-8."""
        decoded = bytearray()
        index = 0
        while index < len(text):
            byte = text[index]
            if byte == 0x2B:  # '+'
                decoded.append(0x20)
                index += 1
            elif (
                byte == 0x25 and _HEX.fullmatch(text[index + 1 : index + 3]) is not None
            ):
                decoded.append(int(text[index + 1 : index + 3], 16))
                index += 3
            else:
                decoded.append(byte)
                index += 1
        try:
            return bytes(decoded).decode("utf-8")
        except UnicodeDecodeError:
            return None
