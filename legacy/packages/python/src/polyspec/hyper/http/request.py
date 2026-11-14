"""The rule of the current path of a request (HY-11.4) as the Python server stated it before `Request.current_path` of
polyspec/hyper/http/request.py called the core (H31.8-1). The header value is text whose characters are the bytes of
the request."""

from __future__ import annotations

import re
from typing import Optional

_AUTHORITY = re.compile(r"^([A-Za-z][A-Za-z0-9+.-]*:)?//[^/?#]*")


def current_path(header: Optional[str]) -> Optional[str]:
    """Returns the path of the page that sent the request, with its bytes read as UTF-8, or None for a request without
    the header, a URL without a path and bytes that are not UTF-8 (HY-11.4)."""
    if header is None:
        return None
    try:
        url = header.encode("latin-1").decode("utf-8")
    except UnicodeDecodeError:
        return None
    rest = _AUTHORITY.sub("", url)
    path = re.split(r"[?#]", rest, maxsplit=1)[0]
    return path or None
