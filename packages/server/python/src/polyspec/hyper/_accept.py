"""The parser of the `Accept` field value by RFC 9110, section 12.5.1, with the qvalue of section 12.4.2 (HY-116)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

_TOKEN = re.compile(r"[!#$%&'*+\-.^_`|~0-9A-Za-z]+")
_QVALUE = re.compile(r"(0(\.[0-9]{0,3})?)|(1(\.0{0,3})?)")
_OWS = " \t"
_QDTEXT = re.compile(r"[\t \x21\x23-\x5b\x5d-\x7e\x80-\xff]")
_QUOTED_PAIR = re.compile(r"[\t \x21-\x7e\x80-\xff]")


class InvalidAccept(ValueError):
    """An `Accept` value that does not follow the grammar of RFC 9110, section 12.5.1, or a weight that is not a
    qvalue; the server answers it with status 400 (HY-116)."""


@dataclass(frozen=True)
class Range:
    """One media range of an `Accept` value: its lower-case type and subtype (`*` for a wildcard), its parameters
    before `q` with lower-case names and unquoted values in their order, and its weight in thousandths (0 to 1000)."""

    type: str
    subtype: str
    parameters: tuple[tuple[str, str], ...]
    weight: int


def parse(value: Optional[str]) -> list[Range]:
    """Returns the ranges of an `Accept` value in their order. A missing value (None) is `*/*`, and an empty value
    is an empty list (HY-116). Fails with InvalidAccept for a value that the grammar does not allow."""
    if value is None:
        return [Range("*", "*", (), 1000)]
    ranges = []
    for element in _split(value, ","):
        element = element.strip(_OWS)
        if element != "":
            ranges.append(_range(element))
    return ranges


def _range(element: str) -> Range:
    """Returns the range of one list element: a media range, its parameters and an optional weight with its accept
    extensions."""
    parts = _split(element, ";")
    media = parts[0].strip(_OWS)
    kind, slash, sub = media.partition("/")
    if slash == "" or not _is_type(kind, sub):
        raise InvalidAccept(f"the media range {media!r} is not a type and a subtype")
    parameters: list[tuple[str, str]] = []
    weight = 1000
    weighted = False
    for part in parts[1:]:
        segment = part.strip(_OWS)
        name, equal, raw = _pair(segment)
        if weighted:
            # HY-116: what follows the weight is an accept extension, which the server does not read.
            if equal and raw is not None:
                _unquote(raw)
            continue
        if name.lower() == "q" and equal:
            weight = _qvalue(raw)
            weighted = True
            continue
        if raw is None:
            raise InvalidAccept(f"the parameter {segment!r} has no value")
        parameters.append((name.lower(), _unquote(raw)))
    return Range(kind.lower(), sub.lower(), tuple(parameters), weight)


def _is_type(kind: str, sub: str) -> bool:
    """Returns True for `*/*`, `type/*` and `type/subtype`, where a wildcard type has a wildcard subtype."""
    if kind == "*":
        return sub == "*"
    return _TOKEN.fullmatch(kind) is not None and (
        sub == "*" or _TOKEN.fullmatch(sub) is not None
    )


def _pair(segment: str) -> tuple[str, bool, Optional[str]]:
    """Splits a parameter or an accept extension into its name, whether an `=` follows it and its raw value. The
    name must be a token, and an `=` must be followed by a token or a quoted string."""
    name, equal, raw = segment.partition("=")
    if _TOKEN.fullmatch(name) is None:
        raise InvalidAccept(f"the parameter name {name!r} is not a token")
    if not equal:
        return name, False, None
    if raw == "" or (_TOKEN.fullmatch(raw) is None and not _is_quoted(raw)):
        raise InvalidAccept(f"the value {raw!r} is neither a token nor a quoted string")
    return name, True, raw


def _qvalue(raw: str) -> int:
    """Returns the weight in thousandths of a qvalue (RFC 9110, section 12.4.2); any other text is invalid."""
    if _QVALUE.fullmatch(raw) is None:
        raise InvalidAccept(f"the weight {raw!r} is not a qvalue")
    if raw.startswith("1"):
        return 1000
    fraction = raw[2:] if "." in raw else ""
    return int(fraction.ljust(3, "0") or "0")


def _is_quoted(raw: str) -> bool:
    """Returns True when the text is one quoted string (RFC 9110, section 5.6.4)."""
    if len(raw) < 2 or raw[0] != '"' or raw[-1] != '"':
        return False
    try:
        _unquote(raw)
    except InvalidAccept:
        return False
    return True


def _unquote(raw: str) -> str:
    """Returns the value of a token or of a quoted string with its quoted pairs read (RFC 9110, section 5.6.4)."""
    if _TOKEN.fullmatch(raw) is not None:
        return raw
    if len(raw) < 2 or raw[0] != '"' or raw[-1] != '"':
        raise InvalidAccept(f"the value {raw!r} is neither a token nor a quoted string")
    inner = raw[1:-1]
    out = []
    index = 0
    while index < len(inner):
        char = inner[index]
        if char == "\\":
            index += 1
            if index == len(inner) or _QUOTED_PAIR.fullmatch(inner[index]) is None:
                raise InvalidAccept(f"the quoted string {raw!r} has an invalid quoted pair")
            out.append(inner[index])
        elif char == '"' or _QDTEXT.fullmatch(char) is None:
            raise InvalidAccept(f"the quoted string {raw!r} has an invalid character")
        else:
            out.append(char)
        index += 1
    return "".join(out)


def _split(text: str, separator: str) -> list[str]:
    """Splits the text at each separator outside a quoted string, keeping the quoted strings whole."""
    parts = []
    current = []
    quoted = False
    escaped = False
    for char in text:
        if quoted:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quoted = False
        elif char == '"':
            quoted = True
        elif char == separator:
            parts.append("".join(current))
            current = []
            continue
        current.append(char)
    parts.append("".join(current))
    return parts
