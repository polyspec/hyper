"""The rule of the tag of a JSON response of a page (HY-53.1) as the Python server stated it before `Page.respond` of
polyspec/hyper/page/_page.py called the core (H31.8-1)."""

from __future__ import annotations

import hashlib


def tag(body: str, masked_token: str, token: str) -> str:
    """Returns the weak tag of a body with the masked token replaced by the session token, so the mask does not change
    it (HY-53)."""
    return (
        'W/"'
        + hashlib.sha256(body.replace(masked_token, token).encode("utf-8")).hexdigest()[
            :32
        ]
        + '"'
    )
