"""The rules of the location of a redirect (HY-46) and of the status of a page result (HY-58) as the Python server
stated them before `Result.redirect` and `Result.page` of polyspec/hyper/result/result.py called the core (H31.8-1)."""

from __future__ import annotations

import re

# A lone surrogate is not UTF-8 text, so that a location holds none (HY-46).
_PATH = re.compile(r"/(?![/\\])[^\x00-\x20\x7f-\x9f\\\ud800-\udfff]*\Z", re.DOTALL)


def redirect(location: str) -> str:
    """Returns the location of a redirect to a path of this application (HY-46)."""
    if _PATH.fullmatch(location) is None or _has_dot_segment(location):
        raise ValueError("a redirect location is not an application path (HY-46)")
    return location


def page(status: int) -> int:
    """Returns the status 200, 409 or 422 of a page result (HY-58)."""
    if type(status) is not int or status not in (200, 409, 422):
        raise ValueError(f"a page status {status} is not 200, 409 or 422 (HY-58)")
    return status


def _has_dot_segment(location: str) -> bool:
    """Returns True when the path of a location has a `.` or `..` segment, also with a percent-encoded dot."""
    path = re.split(r"[?#]", location, maxsplit=1)[0]
    return any(
        re.sub("%2e", ".", segment, flags=re.IGNORECASE) in (".", "..")
        for segment in path.split("/")
    )
