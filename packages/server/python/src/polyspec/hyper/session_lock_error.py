"""The error of a session lock (HY-43, HY-115)."""

from __future__ import annotations


class SessionLockError(RuntimeError):
    """A request could not take the lock of its session, or lost it before it wrote the session (HY-43, HY-115)."""
