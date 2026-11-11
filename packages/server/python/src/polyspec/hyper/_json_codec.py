"""The JSON text of the servers (HY-17, HY-54): the JSON response value, its text with the bytes of PHP
``json_encode`` with ``JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES``, and the decoding of kept values as PHP
``json_decode`` reads them. An instance reads one JSON text from its start to its end."""

from __future__ import annotations

import math
import re
from decimal import Decimal
from typing import NoReturn, Optional

from ._data_model import DataModel
from ._json_decode_error import JsonDecodeError
from ._outside_number import OutsideNumber

# A number of the data model is within ±(2^53 − 1).
_MAX_SAFE = 9007199254740991

_ESCAPES = {
    '"': '\\"',
    "\\": "\\\\",
    "\b": "\\b",
    "\f": "\\f",
    "\n": "\\n",
    "\r": "\\r",
    "\t": "\\t",
    "\u2028": "\\u2028",
    "\u2029": "\\u2029",
}
_ESCAPED = re.compile('["\\\\\x00-\x1f\u2028\u2029]')

_NUMBER = re.compile(r"-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?")
_WHITESPACE = " \t\n\r"
_SIMPLE_ESCAPES = {
    '"': '"',
    "\\": "\\",
    "/": "/",
    "b": "\b",
    "f": "\f",
    "n": "\n",
    "r": "\r",
    "t": "\t",
}
_HEX4 = re.compile(r"[0-9A-Fa-f]{4}")
# PHP json_decode fails when containers nest 512 levels deep.
_MAX_DEPTH = 511


class JsonCodec:
    def __init__(self, text: str) -> None:
        self._text = text
        # The position of the next character to read.
        self._index = 0

    @staticmethod
    def value(
        timezone: str,
        route: str,
        params: dict,
        build: str,
        context: Optional[dict],
        shared: dict,
        regions: dict,
        kept: dict,
    ) -> dict:
        """Returns the JSON response value of a page (HY-17, HY-128): `build` is the build id and `context` the
        member `context` of HY-128 when the response has one, both after `params`; `regions` holds the loader data by
        region name and `kept` the kept values by region name and path."""
        result: dict = {
            "env": {"timezone": timezone},
            "route": route,
            "params": params,
            "build": build,
        }
        if context is not None:
            result["context"] = context
        result.update({"shared": shared, "regions": regions, "kept": kept})
        return result

    @staticmethod
    def encode(value: object) -> str:
        """Returns the JSON text of a value of the data model as PHP ``json_encode`` writes it; a string with a lone
        surrogate, a number that is not finite or a value outside the data model fails (HY-44)."""
        if value is None:
            return "null"
        if isinstance(value, bool):
            return "true" if value else "false"
        if isinstance(value, (int, float)):
            return JsonCodec._encode_number(value)
        if isinstance(value, str):
            return JsonCodec._encode_string(value)
        if isinstance(value, list):
            return "[" + ",".join(JsonCodec.encode(item) for item in value) + "]"
        if isinstance(value, dict):
            items = (
                f"{JsonCodec._encode_string(key)}:{JsonCodec.encode(item)}"
                for key, item in value.items()
            )
            return "{" + ",".join(items) + "}"
        raise TypeError("hyper: the value is not a value of the data model")

    @staticmethod
    def decode(text: str) -> object:
        """Decodes JSON text as PHP ``json_decode`` reads it, with dictionaries for objects in document order. An
        integer literal is an integer and other literals are floats; a number outside ±(2^53 − 1) or one that is not
        finite is an OutsideNumber. Invalid text, a lone surrogate escape, a key that starts with U+0000 or nesting
        deeper than 511 containers fails with JsonDecodeError."""
        reader = JsonCodec(text)
        result = reader._parse_value(0)
        reader._skip_whitespace()
        if reader._index < len(text):
            reader._fail_at("unexpected character after the value")
        return result

    @staticmethod
    def in_data_model(value: object) -> bool:
        """Returns True when a decoded value is a value of the data model (HY-44, HY-54): a number outside
        ±(2^53 − 1) or one that is not finite, which decodes as an OutsideNumber, and nesting deeper than the data
        model allows, are not."""
        return DataModel.contains(value)

    @staticmethod
    def _encode_number(value: int | float) -> str:
        """Writes an integer within ±(2^53 − 1) in decimal and another number with the shortest digits that read back
        as the same number: positional when the decimal point position is between -3 and 17, and otherwise
        ``d.ddde±x`` with at least one fraction digit; negative zero is ``-0`` (HY-54)."""
        number = float(value)
        if not math.isfinite(number):
            raise ValueError("hyper: a number that is not finite has no JSON text")
        if number == 0:
            return "-0" if math.copysign(1.0, number) < 0 else "0"
        if number.is_integer() and abs(number) <= _MAX_SAFE:
            return str(int(number))
        # Decimal(repr(value)) holds the shortest digits that read back as the same float.
        _, digits_tuple, exponent = Decimal(repr(abs(number))).normalize().as_tuple()
        digits = "".join(str(digit) for digit in digits_tuple)
        point = int(exponent) + len(digits_tuple)
        if point < -3 or point > 17:
            power = point - 1
            text = f"{digits[0]}.{digits[1:] or '0'}e{'-' if power < 0 else '+'}{abs(power)}"
        elif point <= 0:
            text = "0." + "0" * -point + digits
        elif len(digits) <= point:
            text = digits + "0" * (point - len(digits))
        else:
            text = digits[:point] + "." + digits[point:]
        return f"-{text}" if number < 0 else text

    @staticmethod
    def _encode_string(text: str) -> str:
        """Escapes the quote, the backslash, the control characters below U+0020 and the line and paragraph separators
        U+2028 and U+2029; every other character, including ``/`` and DEL, stays as it is (HY-54)."""
        JsonCodec._check_well_formed(text)
        return (
            '"'
            + _ESCAPED.sub(
                lambda match: (
                    _ESCAPES.get(match.group(0)) or f"\\u{ord(match.group(0)):04x}"
                ),
                text,
            )
            + '"'
        )

    @staticmethod
    def _check_well_formed(text: str) -> None:
        """Fails for a string with a lone surrogate, which has no UTF-8 form."""
        if any(0xD800 <= ord(char) <= 0xDFFF for char in text):
            raise ValueError("hyper: a string with a lone surrogate is not UTF-8")

    @staticmethod
    def _combine_surrogates(text: str) -> str:
        """Returns the text of decoded string units, in which an escaped high and low surrogate are one character; a
        lone surrogate fails, as PHP json_decode accepts a pair and refuses a lone half."""
        result = []
        index = 0
        while index < len(text):
            code = ord(text[index])
            if (
                0xD800 <= code <= 0xDBFF
                and index + 1 < len(text)
                and 0xDC00 <= ord(text[index + 1]) <= 0xDFFF
            ):
                result.append(
                    chr(
                        0x10000
                        + (code - 0xD800) * 0x400
                        + (ord(text[index + 1]) - 0xDC00)
                    )
                )
                index += 2
                continue
            if 0xD800 <= code <= 0xDFFF:
                raise JsonDecodeError("hyper: lone surrogate")
            result.append(text[index])
            index += 1
        return "".join(result)

    def _fail_at(self, message: str) -> NoReturn:
        """Fails the decoding at the current position."""
        raise JsonDecodeError(f"hyper: {message} at offset {self._index}")

    def _skip_whitespace(self) -> None:
        """Skips the JSON white space."""
        while self._index < len(self._text) and self._text[self._index] in _WHITESPACE:
            self._index += 1

    def _parse_string(self) -> str:
        """Reads a string from its opening quote."""
        self._index += 1
        result = ""
        while True:
            if self._index >= len(self._text):
                self._fail_at("unterminated string")
            char = self._text[self._index]
            if char == '"':
                self._index += 1
                return JsonCodec._combine_surrogates(result)
            if char < " ":
                self._fail_at("control character in string")
            if char != "\\":
                result += char
                self._index += 1
                continue
            escape = (
                self._text[self._index + 1]
                if self._index + 1 < len(self._text)
                else None
            )
            hex4 = self._text[self._index + 2 : self._index + 6]
            if escape is not None and escape in _SIMPLE_ESCAPES:
                result += _SIMPLE_ESCAPES[escape]
                self._index += 2
            elif escape == "u" and _HEX4.fullmatch(hex4) is not None:
                result += chr(int(hex4, 16))
                self._index += 6
            else:
                self._fail_at("invalid escape")

    def _parse_number(self) -> object:
        """Reads a number: an integer literal is an integer and other literals are floats."""
        match = _NUMBER.match(self._text, self._index)
        if match is None:
            self._fail_at("invalid number")
        literal = match.group(0)
        self._index += len(literal)
        value: object = (
            int(literal)
            if match.group(2) is None and match.group(3) is None
            else float(literal)
        )
        number = float(value)  # type: ignore[arg-type]
        if not math.isfinite(number) or abs(number) > _MAX_SAFE:
            return OutsideNumber(literal)
        return value

    def _parse_value(self, depth: int) -> object:
        """Reads a value at a nesting depth."""
        self._skip_whitespace()
        char = self._text[self._index] if self._index < len(self._text) else None
        if char in ("{", "["):
            if depth >= _MAX_DEPTH:
                self._fail_at("nesting is too deep")
            self._index += 1
            self._skip_whitespace()
            close = "}" if char == "{" else "]"
            if self._index < len(self._text) and self._text[self._index] == close:
                self._index += 1
                return {} if char == "{" else []
            items: dict[str, object] = {}
            elements: list[object] = []
            while True:
                if char == "{":
                    self._skip_whitespace()
                    if self._index >= len(self._text) or self._text[self._index] != '"':
                        self._fail_at("expected a string key")
                    key = self._parse_string()
                    if key.startswith("\x00"):
                        self._fail_at("key starts with U+0000")
                    self._skip_whitespace()
                    if self._index >= len(self._text) or self._text[self._index] != ":":
                        self._fail_at('expected ":"')
                    self._index += 1
                    items[key] = self._parse_value(depth + 1)
                else:
                    elements.append(self._parse_value(depth + 1))
                self._skip_whitespace()
                if self._index < len(self._text) and self._text[self._index] == ",":
                    self._index += 1
                    continue
                if self._index < len(self._text) and self._text[self._index] == close:
                    self._index += 1
                    return items if char == "{" else elements
                self._fail_at(f'expected "," or "{close}"')
        if char == '"':
            return self._parse_string()
        for word, result in (("true", True), ("false", False), ("null", None)):
            if self._text.startswith(word, self._index):
                self._index += len(word)
                return result
        if char is not None and (char == "-" or "0" <= char <= "9"):
            return self._parse_number()
        self._fail_at("unexpected character")
