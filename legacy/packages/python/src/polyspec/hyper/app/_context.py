"""The rules of the context hash (HY-125.12) and of the `Hyper-Context` header (HY-127.2) as the Python server stated
them before `Context.hash` and `Context.valid_header` of polyspec/hyper/app/_context.py called the core (H31.8-1)."""

from __future__ import annotations

import hashlib
import re
from typing import Optional


def hash(build: str, text: str) -> str:
    """Returns the context hash: the lowercase hexadecimal SHA-256 digest of `{"build":"<build id>","context":`, the
    JSON text of the context and `}` (HY-125)."""
    signed = '{"build":"' + build + '","context":' + text + "}"
    return hashlib.sha256(signed.encode("utf-8")).hexdigest()


def valid_header(value: Optional[str]) -> bool:
    """Returns True for a request without `Hyper-Context` or with a context hash, 64 lowercase hexadecimal (HY-127)."""
    return value is None or re.fullmatch(r"[0-9a-f]{64}", value) is not None
