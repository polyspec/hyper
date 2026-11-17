"""The changed topics of a request, by which the core selects the regions that a response contains (HY-11, HY-18,
HY-19)."""

from __future__ import annotations

from ..http.request import Request
from ._router import Router
from ..session._flash import Flash


class RegionPlanner:
    @staticmethod
    def changed_topics(request: Request, flash: Flash, base_path: str) -> list[str]:
        """Returns the changed topics: the topics of the previous action, and `path` after navigation (HY-11)."""
        topics = list(flash.changed)
        current = request.current_path()
        if current is not None:
            stripped = Router.strip_base_path(current, base_path)
            if (stripped if stripped is not None else current) != request.path():
                topics.append("path")
        return list(dict.fromkeys(topics))
