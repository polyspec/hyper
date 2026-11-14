"""The rules of the masked session token (HY-24.2, HY-24.4, HY-24.10, HY-24.12) as the Python server stated them before
`Csrf.mask`, `Csrf.verify` and `Csrf.browser_of` of polyspec/hyper/session/_csrf.py called the core (H31.8-1)."""

from __future__ import annotations

import hashlib
import hmac
import re
from typing import Optional

_MASKED = re.compile(r"[0-9a-f]{128}\Z")
_TOKEN = re.compile(r"[0-9a-f]{64}\Z")
_DIGITS = re.compile(r"(?:[0-9a-f]{2})*\Z")


def mask(token: str, mask: str) -> str:
    """Returns the token masked with a mask; both are 64 lowercase hexadecimal digits."""
    _require_token(token)
    _require_token(mask)
    return mask + _xor(_bytes(mask), _bytes(token)).hex()


def verify(token: str, value: str) -> bool:
    """Returns True when a form value is a masked value of the token, compared in constant time."""
    _require_token(token)
    if _MASKED.fullmatch(value) is None:
        return False
    unmasked = _xor(_bytes(value[64:]), _bytes(value[:64]))
    return hmac.compare_digest(_bytes(token), unmasked)


def browser_of(masked: str) -> Optional[str]:
    """Returns the SHA-256 digest, as 64 lowercase hexadecimal digits, of the token that a masked value holds, or None
    for the empty text, which a request without a session holds (HY-24.10, HY-24.12)."""
    if masked == "":
        return None
    head, rest = masked[:64], masked[64:]
    _require_token(head)
    _require_token(rest)
    return hashlib.sha256(_xor(_bytes(rest), _bytes(head))).hexdigest()


def _require_token(text: str) -> None:
    """Fails for a token or a mask that is not 64 lowercase hexadecimal digits (HY-24.9)."""
    if _TOKEN.fullmatch(text) is None:
        raise ValueError(
            "a CSRF token or mask is not 64 lowercase hexadecimal digits (HY-24)"
        )


def _bytes(hex_text: str) -> bytes:
    """Returns the bytes of an even number of lowercase hexadecimal digits; other text fails. bytes.fromhex accepts
    upper case digits and white space, so the digits are checked first."""
    if _DIGITS.fullmatch(hex_text) is None:
        raise ValueError(
            "a CSRF token or mask is not lowercase hexadecimal digits (HY-24)"
        )
    return bytes.fromhex(hex_text)


def _xor(first: bytes, second: bytes) -> bytes:
    """Returns the bytes of the first XOR the bytes of the second, which have one length; other bytes fail."""
    if len(first) != len(second):
        raise ValueError(
            "the bytes of a CSRF token and its mask differ in length (HY-24)"
        )
    return bytes(a ^ b for a, b in zip(first, second, strict=True))
