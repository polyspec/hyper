"""JSON text with the bytes of the PHP server (HY-17, HY-54): PHP encodes with
``json_encode(JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)`` and decodes kept values with ``json_decode``. The
PHP and the JavaScript server pass the same cases of conformance/json.json."""

from __future__ import annotations

import math
import re
from decimal import Decimal
from typing import Optional

# A number of the data model is within ±(2^53 − 1).
MAX_SAFE = 9007199254740991

_ESCAPES = {'"': '\\"', '\\': '\\\\', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t',
            '\u2028': '\\u2028', '\u2029': '\\u2029'}
_ESCAPED = re.compile('["\\\\\x00-\x1f\u2028\u2029]')

_NUMBER = re.compile(r'-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?')
_WHITESPACE = ' \t\n\r'
_SIMPLE_ESCAPES = {'"': '"', '\\': '\\', '/': '/', 'b': '\b', 'f': '\f', 'n': '\n', 'r': '\r', 't': '\t'}
_HEX4 = re.compile(r'[0-9A-Fa-f]{4}')
# PHP json_decode fails when containers nest 512 levels deep.
_MAX_DEPTH = 511


def encode(value) -> str:
    """Returns the JSON text of a value of the data model as PHP ``json_encode`` writes it; a value outside the data
    model fails (HY-44)."""
    if value is None:
        return 'null'
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, (int, float)):
        return encode_number(value)
    if isinstance(value, str):
        return encode_string(value)
    if isinstance(value, list):
        return '[' + ','.join(encode(item) for item in value) + ']'
    if isinstance(value, dict):
        return '{' + ','.join(f'{encode_string(key)}:{encode(item)}' for key, item in value.items()) + '}'
    raise TypeError('hyper: the value is not a value of the data model')


def encode_number(value: int | float) -> str:
    """Writes an integer in decimal and a float with the shortest digits that read back as the same float: positional
    when the decimal point position is between -3 and 17, and otherwise ``d.ddde±x`` with at least one fraction
    digit. A float with an integer value has no fraction, and negative zero is ``-0``."""
    number = float(value)
    if not math.isfinite(number):
        raise ValueError('hyper: a number that is not finite has no JSON text')
    if number == 0:
        return '-0' if math.copysign(1.0, number) < 0 else '0'
    if number.is_integer() and abs(number) <= MAX_SAFE:
        return str(int(number))
    # Decimal(repr(value)) holds the shortest digits that read back as the same float.
    _, digits_tuple, exponent = Decimal(repr(abs(number))).normalize().as_tuple()
    digits = ''.join(str(digit) for digit in digits_tuple)
    point = exponent + len(digits_tuple)
    if point < -3 or point > 17:
        power = point - 1
        text = f'{digits[0]}.{digits[1:] or "0"}e{"-" if power < 0 else "+"}{abs(power)}'
    elif point <= 0:
        text = '0.' + '0' * -point + digits
    elif len(digits) <= point:
        text = digits + '0' * (point - len(digits))
    else:
        text = digits[:point] + '.' + digits[point:]
    return f'-{text}' if number < 0 else text


def encode_string(text: str) -> str:
    """Escapes the quote, the backslash, the control characters below U+0020 and the line and paragraph separators
    U+2028 and U+2029; every other character, including ``/`` and DEL, stays as it is."""
    _check_well_formed(text)

    def escape(match: 're.Match[str]') -> str:
        char = match.group(0)
        return _ESCAPES.get(char) or f'\\u{ord(char):04x}'

    return '"' + _ESCAPED.sub(escape, text) + '"'


class OutsideNumber:
    """A number of a JSON text that has no value in the data model: a number outside ±(2^53 − 1) or one that is not
    finite (HY-38, HY-40)."""

    def __init__(self, literal: str):
        self.literal = literal


class JsonDecodeError(ValueError):
    """Invalid JSON text."""


def decode(text: str) -> object:
    """Decodes JSON text as PHP ``json_decode`` reads it, with dictionaries for objects in document order. An
    integer literal is an integer and other literals are floats; a number outside ±(2^53 − 1) or one that is not
    finite is an :class:`OutsideNumber`. Invalid text, a lone surrogate escape, a key that starts with U+0000 or
    nesting deeper than 511 containers fails with :class:`JsonDecodeError`."""
    parser = _Parser(text)
    value = parser.value(0)
    parser.whitespace()
    if parser.index < len(text):
        parser.fail('unexpected character after the value')
    return value


def in_data_model(value: object) -> bool:
    """Returns True when a decoded value contains no :class:`OutsideNumber`, so that it is a value of the data
    model."""
    if isinstance(value, OutsideNumber):
        return False
    if isinstance(value, list):
        return all(in_data_model(item) for item in value)
    if isinstance(value, dict):
        return all(in_data_model(item) for item in value.values())
    return True


class _Parser:
    def __init__(self, text: str):
        self.text = text
        self.index = 0

    def fail(self, message: str) -> None:
        raise JsonDecodeError(f'hyper: {message} at offset {self.index}')

    def whitespace(self) -> None:
        while self.index < len(self.text) and self.text[self.index] in _WHITESPACE:
            self.index += 1

    def string(self) -> str:
        self.index += 1
        result = ''
        while True:
            if self.index >= len(self.text):
                self.fail('unterminated string')
            char = self.text[self.index]
            if char == '"':
                self.index += 1
                return _combine_surrogates(result)
            if char < ' ':
                self.fail('control character in string')
            if char != '\\':
                result += char
                self.index += 1
                continue
            escape = self.text[self.index + 1] if self.index + 1 < len(self.text) else None
            if escape in _SIMPLE_ESCAPES:
                result += _SIMPLE_ESCAPES[escape]
                self.index += 2
            elif escape == 'u' and _HEX4.fullmatch(self.text[self.index + 2:self.index + 6]) is not None:
                result += chr(int(self.text[self.index + 2:self.index + 6], 16))
                self.index += 6
            else:
                self.fail('invalid escape')

    def number(self) -> object:
        match = _NUMBER.match(self.text, self.index)
        if match is None:
            self.fail('invalid number')
        literal = match.group(0)
        self.index += len(literal)
        if match.group(2) is None and match.group(3) is None:
            value: object = int(literal)
        else:
            value = float(literal)
        number = float(value)
        if not math.isfinite(number) or abs(number) > MAX_SAFE:
            return OutsideNumber(literal)
        return value

    def value(self, depth: int) -> object:
        self.whitespace()
        char = self.text[self.index] if self.index < len(self.text) else None
        if char in ('{', '['):
            if depth >= _MAX_DEPTH:
                self.fail('nesting is too deep')
            self.index += 1
            self.whitespace()
            close = '}' if char == '{' else ']'
            if self.index < len(self.text) and self.text[self.index] == close:
                self.index += 1
                return {} if char == '{' else []
            items: dict[str, object] = {}
            elements: list[object] = []
            while True:
                if char == '{':
                    self.whitespace()
                    if self.index >= len(self.text) or self.text[self.index] != '"':
                        self.fail('expected a string key')
                    key = self.string()
                    if key.startswith('\x00'):
                        self.fail('key starts with U+0000')
                    self.whitespace()
                    if self.index >= len(self.text) or self.text[self.index] != ':':
                        self.fail('expected ":"')
                    self.index += 1
                    items[key] = self.value(depth + 1)
                else:
                    elements.append(self.value(depth + 1))
                self.whitespace()
                if self.index < len(self.text) and self.text[self.index] == ',':
                    self.index += 1
                    continue
                if self.index < len(self.text) and self.text[self.index] == close:
                    self.index += 1
                    return items if char == '{' else elements
                self.fail(f'expected "," or "{close}"')
        if char == '"':
            return self.string()
        for word, result in (('true', True), ('false', False), ('null', None)):
            if self.text.startswith(word, self.index):
                self.index += len(word)
                return result
        if char is not None and (char == '-' or '0' <= char <= '9'):
            return self.number()
        self.fail('unexpected character')


def _combine_surrogates(text: str) -> str:
    """Merges an adjacent high and low surrogate into one character; a lone surrogate fails (PHP json_decode accepts
    a pair and refuses a lone half)."""
    result = []
    index = 0
    while index < len(text):
        code = ord(text[index])
        if 0xD800 <= code <= 0xDBFF:
            if index + 1 < len(text) and 0xDC00 <= ord(text[index + 1]) <= 0xDFFF:
                result.append(chr(0x10000 + (code - 0xD800) * 0x400 + (ord(text[index + 1]) - 0xDC00)))
                index += 2
                continue
            raise JsonDecodeError('hyper: lone surrogate')
        if 0xDC00 <= code <= 0xDFFF:
            raise JsonDecodeError('hyper: lone surrogate')
        result.append(text[index])
        index += 1
    return ''.join(result)


def _check_well_formed(text: str) -> None:
    """Fails for a string with a lone surrogate, which has no UTF-8 form."""
    index = 0
    while index < len(text):
        code = ord(text[index])
        if 0xD800 <= code <= 0xDFFF:
            raise ValueError('hyper: a string with a lone surrogate is not UTF-8')
        index += 1
