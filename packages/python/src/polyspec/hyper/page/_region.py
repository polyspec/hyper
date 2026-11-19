"""One manifest region: the page region, or a region with its own template (HY-2). The core selects the regions of a
response by their used topics from the manifest (HY-18, HY-19), so a region holds no topics."""

from __future__ import annotations

import re
from typing import Optional

from ..app._core_rules import open_error
from ..data._kept import KINDS

_PATH = re.compile(r"[A-Za-z_][A-Za-z0-9_]*(\.([A-Za-z_][A-Za-z0-9_]*|[0-9]+))*\Z")


class Region:
    """One region of the manifest or of a route."""

    name: str
    page: bool
    template: Optional[str]
    keep: dict[str, str]

    def __init__(
        self,
        name: str,
        page: bool,
        template: Optional[str],
        keep: Optional[dict[str, str]] = None,
    ):
        self.name = name
        self.page = page
        self.template = template
        self.keep = keep or {}
        for path, kind in self.keep.items():
            if _PATH.fullmatch(path) is None or kind not in KINDS:
                raise open_error(f"region {name} has an invalid kept path {path}")

    def kept_paths(self, kinds: list[str]) -> list[str]:
        """Returns the kept paths of the given kinds."""
        return [path for path, kind in self.keep.items() if kind in kinds]
