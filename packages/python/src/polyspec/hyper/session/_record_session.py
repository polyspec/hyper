"""The session cookie that the PHP, Node and Python servers share (HY-45): its name and the Set-Cookie value of a new
session, which the core gives. The record of a session is kept by the session-store library (HY-104.25)."""

from __future__ import annotations

from ..app._core_rules import CoreRules


class RecordSession:
    """The name and the header of the session cookie."""

    @staticmethod
    def cookie_name(secure: bool) -> str:
        """Returns the session cookie name: `__Host-hy-session` over HTTPS and `hy-session` otherwise (HY-45); the core
        names it (HY-133.2)."""
        return CoreRules.shared().session_cookie_name(secure)

    @staticmethod
    def cookie_header(id: str, secure: bool) -> str:
        """Returns the Set-Cookie value of a new session (HY-45.8); the core writes it (HY-133.2)."""
        return CoreRules.shared().session_cookie_header(id, secure)
