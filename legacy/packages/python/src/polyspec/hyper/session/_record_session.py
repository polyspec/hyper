"""The rule of the name of the session cookie (HY-45.1) as the Python server stated it before
`RecordSession.cookie_name` of polyspec/hyper/session/_record_session.py called the core (H31.8-1)."""

from __future__ import annotations


def cookie_name(secure: bool) -> str:
    """Returns the session cookie name: `__Host-hy-session` over HTTPS and `hy-session` otherwise (HY-45)."""
    return "__Host-hy-session" if secure else "hy-session"
