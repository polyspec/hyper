"""The action of a request that answers its route page (HY-72.3, HY-107.9)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional


@dataclass(frozen=True)
class PageAction:
    """The action of a request that answers its route page: its result, or None for an action that let
    `revision_changed` escape (HY-107.9), and the masked value of the token that the request held before the action,
    which differs from that of the request of the page after a renewal (HY-72.3)."""

    result: Optional[Any]
    masked: str
