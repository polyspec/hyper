"""The masked session token (HY-24). A masked value is 32 mask bytes followed by the mask XOR the token, as 128
lowercase hexadecimal digits, so no response contains the token. The core masks a token and reads the browser of a
masked value (HY-132.2)."""

from __future__ import annotations

import hmac
import re
import secrets
from typing import Optional

from ..app._core_rules import core_rules

_MASKED = re.compile(r"[0-9a-f]{128}\Z")
_TOKEN = re.compile(r"[0-9a-f]{64}\Z")
_DIGITS = re.compile(r"(?:[0-9a-f]{2})*\Z")


class Csrf:
    @staticmethod
    def masked(token: str) -> str:
        """Returns the token masked with a new random mask."""
        return Csrf.mask(token, secrets.token_bytes(32).hex())

    @staticmethod
    def mask(token: str, mask: str) -> str:
        """Returns the token masked with a mask; both are 64 lowercase hexadecimal digits."""
        return core_rules().csrf_mask(token, mask)

    @staticmethod
    def verify(token: str, value: str) -> bool:
        """Returns True when a form value is a masked value of the token, compared in constant time."""
        Csrf._require_token(token)
        if _MASKED.fullmatch(value) is None:
            return False
        unmasked = Csrf._xor(Csrf._bytes(value[64:]), Csrf._bytes(value[:64]))
        return hmac.compare_digest(Csrf._bytes(token), unmasked)

    @staticmethod
    def browser_of(masked: str) -> Optional[str]:
        """Returns the SHA-256 digest, as 64 lowercase hexadecimal digits, of the token that a masked value holds, or
        None for the empty text, which a request without a session holds (HY-24.10, HY-24.12)."""
        return core_rules().csrf_browser_of(masked)

    @staticmethod
    def _require_token(text: str) -> None:
        """Fails for a token or a mask that is not 64 lowercase hexadecimal digits (HY-24.9)."""
        if _TOKEN.fullmatch(text) is None:
            raise ValueError(
                "a CSRF token or mask is not 64 lowercase hexadecimal digits (HY-24)"
            )

    @staticmethod
    def _bytes(hex_text: str) -> bytes:
        """Returns the bytes of an even number of lowercase hexadecimal digits; other text fails. bytes.fromhex
        accepts upper case digits and white space, so the digits are checked first."""
        if _DIGITS.fullmatch(hex_text) is None:
            raise ValueError(
                "a CSRF token or mask is not lowercase hexadecimal digits (HY-24)"
            )
        return bytes.fromhex(hex_text)

    @staticmethod
    def _xor(first: bytes, second: bytes) -> bytes:
        """Returns the bytes of the first XOR the bytes of the second, which have one length; other bytes fail."""
        if len(first) != len(second):
            raise ValueError(
                "the bytes of a CSRF token and its mask differ in length (HY-24)"
            )
        return bytes(a ^ b for a, b in zip(first, second, strict=True))
