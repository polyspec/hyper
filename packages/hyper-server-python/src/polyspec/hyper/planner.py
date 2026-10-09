"""Selects the regions that a response contains (HY-11, HY-18, HY-19)."""

from __future__ import annotations

from .manifest import Manifest
from .request import Request
from .router import strip_base_path
from .session import Flash


def changed_topics(request: Request, flash: Flash, base_path: str) -> list[str]:
    """Returns the changed topics: the topics of the previous action, and `path` after navigation (HY-11)."""
    topics = list(flash.changed)
    current = request.current_path()
    if current is not None:
        stripped = strip_base_path(current, base_path)
        if (stripped if stripped is not None else current) != request.path():
            topics.append('path')
    seen: set[str] = set()
    return [topic for topic in topics if not (topic in seen or seen.add(topic))]


def select(manifest: Manifest, document: bool, changed: list[str]):
    """Returns every region in manifest order for a document, and the page region followed by the regions that use a
    changed topic for a region request."""
    if document:
        return list(manifest.regions)
    return [manifest.page, *[region for region in manifest.regions
                             if not region.page and region.uses_any(changed)]]
