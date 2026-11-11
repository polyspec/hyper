"""The `Accept` field of a request: its parser (RFC 9110, section 12.5.1) and the selection of a media type by the
weights of its ranges (HY-116). An instance reads one value from its start to its end."""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from typing import Optional

from ._invalid_accept import InvalidAccept
from ._media_range import MediaRange

# The weight of a range without q, and of q=1, in thousandths (RFC 9110, section 12.4.2).
_ANY = 1000
# The characters of a token (RFC 9110, section 5.6.2).
_TCHAR = frozenset(
    "!#$%&'*+-.^_`|~0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
)
_QVALUE = re.compile(r"0(\.[0-9]{0,3})?|1(\.0{0,3})?")


class Accept:
    def __init__(self, text: str) -> None:
        self._text = text
        # The position of the next character to read.
        self._pos = 0

    @staticmethod
    def parse(value: Optional[str]) -> list[MediaRange]:
        """Parses an `Accept` field value into its ranges, in order. None is a request without `Accept`, which reads
        as the range that matches every type (RFC 9110, section 12.5.1; HY-116). An empty value is an empty list, and
        an empty list element is ignored (RFC 9110, section 5.6.1). The names of the types, subtypes and parameters
        are in lower case. The parameters are those before `q`, and the weight is the qvalue in thousandths (RFC
        9110, section 12.4.2). What follows `q` is an accept extension, which is checked and not read. Raises
        InvalidAccept for a value that the grammar does not allow, or a weight that is not a qvalue."""
        if value is None:
            return [MediaRange("*", "*", (), _ANY)]
        reader = Accept(value)
        ranges = []
        reader._skip_ows()
        while not reader._end():
            if reader._at(","):
                reader._pos += 1
                reader._skip_ows()
                continue
            ranges.append(reader._range())
            reader._skip_ows()
            if not reader._end():
                reader._expect(",")
                reader._skip_ows()
        return ranges

    @staticmethod
    def select(value: Optional[str], types: Sequence[str]) -> Optional[str]:
        """Returns the media type of the request among the given types, or None when no type has a weight above 0
        (HY-116). A type takes the weight of its most specific matching range, and among the ranges of that
        specificity the one of the highest weight. The first type of the list wins a tie. Raises InvalidAccept as
        `parse` does."""
        return Accept.best(Accept.parse(value), types)[0]

    @staticmethod
    def best(ranges: Sequence[MediaRange], types: Sequence[str]) -> tuple[Optional[str], int]:
        """Returns the type of the highest weight among the given types with that weight in thousandths, the first
        on a tie, or None and 0 when no type has a weight above 0 (HY-116)."""
        selected: Optional[str] = None
        best = 0
        for media in types:
            weight = Accept._type_weight(ranges, media)
            if weight > best:
                selected, best = media, weight
        return selected, best

    @staticmethod
    def _type_weight(ranges: Sequence[MediaRange], media: str) -> int:
        """Returns the weight in thousandths that the ranges give a type: the weight of the most specific range that
        matches it, or 0 when no range matches. A range that names the type matches it whatever its parameters
        (HY-116)."""
        name, _, subtype = media.partition("/")
        specificity = 0
        weight = 0
        for item in ranges:
            if item.type == "*":
                match = 1
            elif item.type == name and item.subtype == "*":
                match = 2
            elif item.type == name and item.subtype == subtype:
                match = 3
            else:
                continue
            if match > specificity or (match == specificity and item.weight > weight):
                specificity, weight = match, item.weight
        return weight

    def _range(self) -> MediaRange:
        """Reads one media range: `type "/" subtype`, then its parameters and its weight (RFC 9110, section
        12.5.1)."""
        kind = self._token().lower()
        self._expect("/")
        subtype = self._token().lower()
        if kind == "*" and subtype != "*":
            raise self._invalid("a wildcard type has a subtype")
        parameters: list[tuple[str, str]] = []
        weight = _ANY
        weighted = False
        while True:
            self._skip_ows()
            if not self._at(";"):
                break
            self._pos += 1
            self._skip_ows()
            name = self._token().lower()
            if weighted:
                # An accept extension after the weight: `token [ "=" ( token / quoted-string ) ]`, read and not kept.
                if self._at("="):
                    self._pos += 1
                    self._parameter_value()
                continue
            self._expect("=")
            if name == "q":
                weight = self._qvalue()
                weighted = True
                continue
            parameters.append((name, self._parameter_value()))
        return MediaRange(kind, subtype, tuple(parameters), weight)

    def _qvalue(self) -> int:
        """Reads a qvalue and returns it in thousandths: `0[.000-999]` or `1[.000]` (RFC 9110, section 12.4.2)."""
        text = self._token()
        if _QVALUE.fullmatch(text) is None:
            raise self._invalid(f"the weight {text} is not a qvalue")
        whole, _, fraction = text.partition(".")
        return int(whole) * _ANY + int(fraction.ljust(3, "0"))

    def _parameter_value(self) -> str:
        """Reads a parameter value, a token or a quoted string, and returns it unquoted (RFC 9110, section 5.6.6)."""
        return self._quoted() if self._at('"') else self._token()

    def _quoted(self) -> str:
        """Reads a quoted string and returns its text without the quotes and the quoted pairs (RFC 9110, section
        5.6.4)."""
        self._expect('"')
        text = []
        while True:
            if self._end():
                raise self._invalid("an unterminated quoted string")
            char = self._text[self._pos]
            self._pos += 1
            if char == '"':
                return "".join(text)
            if char == "\\":
                if self._end() or not Accept._quoted_pair_character(
                    ord(self._text[self._pos])
                ):
                    raise self._invalid("an invalid quoted pair")
                text.append(self._text[self._pos])
                self._pos += 1
                continue
            if not Accept._qdtext_character(ord(char)):
                raise self._invalid("an invalid character in a quoted string")
            text.append(char)

    @staticmethod
    def _qdtext_character(code: int) -> bool:
        """Whether a character is a qdtext: HTAB, SP, %x21, %x23-5B, %x5D-7E or obs-text (RFC 9110, section
        5.6.4)."""
        return (
            code in (0x09, 0x20, 0x21)
            or 0x23 <= code <= 0x5B
            or 0x5D <= code <= 0x7E
            or 0x80 <= code <= 0xFF
        )

    @staticmethod
    def _quoted_pair_character(code: int) -> bool:
        """Whether a character may follow the backslash of a quoted pair: HTAB, SP, VCHAR or obs-text (RFC 9110,
        section 5.6.4)."""
        return code in (0x09, 0x20) or 0x21 <= code <= 0x7E or 0x80 <= code <= 0xFF

    def _token(self) -> str:
        """Reads a token (RFC 9110, section 5.6.2)."""
        start = self._pos
        while not self._end() and self._text[self._pos] in _TCHAR:
            self._pos += 1
        if start == self._pos:
            raise self._invalid("expected a token")
        return self._text[start : self._pos]

    def _skip_ows(self) -> None:
        """Skips the optional white space (RFC 9110, section 5.6.3)."""
        while self._at(" ") or self._at("\t"):
            self._pos += 1

    def _expect(self, char: str) -> None:
        """Reads the character `char`, which must come next."""
        if not self._at(char):
            raise self._invalid(f"expected {char}")
        self._pos += 1

    def _at(self, char: str) -> bool:
        """Whether the next character is `char`."""
        return self._pos < len(self._text) and self._text[self._pos] == char

    def _end(self) -> bool:
        """Whether the whole value has been read."""
        return self._pos >= len(self._text)

    def _invalid(self, reason: str) -> InvalidAccept:
        """The error of a value that the grammar does not allow, at the current position."""
        text = json.dumps(self._text, ensure_ascii=False)
        return InvalidAccept(
            f"hyper: the Accept value {text} is invalid at {self._pos}: {reason} (HY-116)"
        )
