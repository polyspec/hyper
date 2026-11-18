"""The masked session token (HY-24). A masked value is 32 mask bytes followed by the mask XOR the token, as 128
lowercase hexadecimal digits, so no response contains the token. The core masks a token, verifies a masked value
and reads its browser (HY-133.2)."""

from __future__ import annotations

import secrets
from typing import Optional

from ..app._core_rules import core_rules


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
        """Returns True when a form value is a masked value of the token, compared in constant time; the core checks
        it (HY-133.2)."""
        return core_rules().csrf_verify(token, value)

    @staticmethod
    def browser_of(masked: str) -> Optional[str]:
        """Returns the SHA-256 digest, as 64 lowercase hexadecimal digits, of the token that a masked value holds, or
        None for the empty text, which a request without a session holds (HY-24.10, HY-24.12)."""
        return core_rules().csrf_browser_of(masked)
