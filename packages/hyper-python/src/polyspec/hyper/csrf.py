"""The masked session token (HY-24). A masked value is 32 mask bytes followed by the mask XOR the token, as 128
lowercase hexadecimal digits, so no response contains the token. The PHP and the JavaScript implementation pass the
same cases of conformance/csrf.json."""

from __future__ import annotations

import hmac
import re
import secrets

_MASKED = re.compile(r'[0-9a-f]{128}\Z')


def masked(token: str) -> str:
    """Returns the token masked with a new random mask."""
    return mask(token, secrets.token_bytes(32).hex())


def mask(token: str, mask: str) -> str:
    """Returns the token masked with a mask; both are 64 lowercase hexadecimal digits."""
    return mask + _xor(_bytes(mask), _bytes(token)).hex()


def verify(token: str, value: str) -> bool:
    """Returns True when a form value is a masked value of the token, compared in constant time."""
    if _MASKED.fullmatch(value) is None:
        return False
    unmasked = _xor(_bytes(value[64:]), _bytes(value[:64]))
    return hmac.compare_digest(unmasked, _bytes(token))


def _xor(first: bytes, second: bytes) -> bytes:
    return bytes(a ^ b for a, b in zip(first, second))


def _bytes(hex_text: str) -> bytes:
    """Returns the bytes of an even number of hexadecimal digits; other text fails."""
    return bytes.fromhex(hex_text)
