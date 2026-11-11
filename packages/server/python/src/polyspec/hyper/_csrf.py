"""The masked session token (HY-24). A masked value is 32 mask bytes followed by the mask XOR the token, as 128
lowercase hexadecimal digits, so no response contains the token."""

from __future__ import annotations

import hmac
import re
import secrets

_MASKED = re.compile(r"[0-9a-f]{128}\Z")


class Csrf:
    @staticmethod
    def masked(token: str) -> str:
        """Returns the token masked with a new random mask."""
        return Csrf.mask(token, secrets.token_bytes(32).hex())

    @staticmethod
    def mask(token: str, mask: str) -> str:
        """Returns the token masked with a mask; both are 64 lowercase hexadecimal digits."""
        return mask + Csrf._xor(Csrf._bytes(mask), Csrf._bytes(token)).hex()

    @staticmethod
    def verify(token: str, value: str) -> bool:
        """Returns True when a form value is a masked value of the token, compared in constant time."""
        if _MASKED.fullmatch(value) is None:
            return False
        unmasked = Csrf._xor(Csrf._bytes(value[64:]), Csrf._bytes(value[:64]))
        return hmac.compare_digest(Csrf._bytes(token), unmasked)

    @staticmethod
    def _bytes(hex_text: str) -> bytes:
        """Returns the bytes of an even number of hexadecimal digits; other text fails."""
        return bytes.fromhex(hex_text)

    @staticmethod
    def _xor(first: bytes, second: bytes) -> bytes:
        """Returns the bytes of the first XOR the bytes of the second, as long as the shorter."""
        return bytes(a ^ b for a, b in zip(first, second))
