"""The rules of the values that a reply keeps, its `Cache-Control` (HY-52.6), its `Referrer-Policy` (HY-103.2, HY-103.9)
and its page status (HY-69), as the Python server stated them before `Reply.cache_control`, `Reply.referrer_policy`
and `Reply.status` of polyspec/hyper/http/reply.py called the core (H31.8-1). The server still checks the type of each
argument before the rule."""

from __future__ import annotations

import re

_CACHE_CONTROL = re.compile(r"[\x20-\x7e]+\Z")
# The tokens of the Referrer-Policy specification that a reply may set (HY-103).
_REFERRER_POLICIES = (
    "no-referrer",
    "no-referrer-when-downgrade",
    "origin",
    "origin-when-cross-origin",
    "same-origin",
    "strict-origin",
    "strict-origin-when-cross-origin",
    "unsafe-url",
)


def cache_control(value: str) -> str:
    """Returns the Cache-Control of a page response with status 200, which keeps the page out of shared caches: it has
    `private` or `no-store` and neither `public` nor `s-maxage` (HY-52)."""
    if _CACHE_CONTROL.fullmatch(value) is None:
        raise ValueError("Cache-Control has a character that is not allowed (HY-52)")
    directives = [part.split("=", 1)[0].strip().lower() for part in value.split(",")]
    if not any(name in ("private", "no-store") for name in directives) or any(
        name in ("public", "s-maxage") for name in directives
    ):
        raise ValueError(
            f"Cache-Control {value} lets a shared cache store the page; "
            "it needs private or no-store and neither public nor s-maxage (HY-52)"
        )
    return value


def referrer_policy(value: str) -> str:
    """Returns a token of the Referrer-Policy specification; another value fails (HY-103)."""
    if value not in _REFERRER_POLICIES:
        raise ValueError(
            f"Referrer-Policy {value} is not a token of the Referrer-Policy specification (HY-103)"
        )
    return value


def status(code: int) -> int:
    """Returns the page status 403 of a reply; another status fails (HY-69)."""
    if code != 403:
        raise ValueError(f"page status {code} of a reply is not 403 (HY-69)")
    return code
