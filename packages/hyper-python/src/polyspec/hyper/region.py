"""One manifest region: the page region, or a region with its own template and used topics (HY-2)."""

from __future__ import annotations

import re
from typing import Optional

from .kept import KINDS

_PATH = re.compile(r'[A-Za-z_][A-Za-z0-9_]*(\.([A-Za-z_][A-Za-z0-9_]*|[0-9]+))*\Z')


class Region:
    """One region of the manifest or of a route."""

    def __init__(self, name: str, page: bool, template: Optional[str], uses: list[str],
                 keep: Optional[dict[str, str]] = None):
        self.name = name
        self.page = page
        self.template = template
        self.uses = uses
        self.keep: dict[str, str] = keep or {}
        for path, kind in self.keep.items():
            if _PATH.fullmatch(path) is None or kind not in KINDS:
                raise ValueError(f'region {name} has an invalid kept path {path}')

    def kept_paths(self, kinds: list[str]) -> list[str]:
        """Returns the kept paths of the given kinds."""
        return [path for path, kind in self.keep.items() if kind in kinds]

    def uses_any(self, topics: list[str]) -> bool:
        """Returns True when this region uses one of the topics."""
        return any(topic in self.uses for topic in topics)
