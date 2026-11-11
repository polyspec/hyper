"""The cookies of a request: one parse of its `Cookie` header (HY-129), the same in every server."""

from __future__ import annotations

import re
from typing import Optional

_PERCENT = re.compile(rb"%([0-9A-Fa-f]{2})")


def parse(header: Optional[bytes]) -> dict[str, str]:
    """Returns the cookies of a `Cookie` header, or none for a request without the header. The header splits at
    each `;`; spaces and tabs at both ends of a pair are removed; a pair splits at its first `=`. A pair gives no
    cookie when it has no `=`, an empty name, a name that is not UTF-8 (the name is not decoded), or a value that is
    not UTF-8 after percent-decoding. Of the pairs that give a cookie, the first of a name counts."""
    cookies: dict[str, str] = {}
    if header is None:
        return cookies
    for pair in header.split(b";"):
        pair = pair.strip(b" \t")
        equals = pair.find(b"=")
        if equals < 0:
            continue
        name = _text(pair[:equals])
        value = _text(_percent_decode(pair[equals + 1 :]))
        if name and value is not None and name not in cookies:
            cookies[name] = value
    return cookies


def _percent_decode(data: bytes) -> bytes:
    """Replaces each `%` with two hexadecimal digits by its byte; every other byte, `+` included, is kept."""
    return _PERCENT.sub(lambda match: bytes([int(match.group(1), 16)]), data)


def _text(data: bytes) -> Optional[str]:
    """Returns the bytes as UTF-8 text, or None when they are not UTF-8."""
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return None
