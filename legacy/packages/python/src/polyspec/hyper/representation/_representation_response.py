"""The rule of the strong tag of a representation (HY-122.10) as the Python server stated it before
`RepresentationResponse.etag` of polyspec/hyper/representation/_representation_response.py called the core
(H31.8-1)."""

from __future__ import annotations

import hashlib


def etag(content_type: str, body: str) -> str:
    """Returns the strong tag of a body of a type: the first 32 hexadecimal digits of the SHA-256 digest of the
    `Content-Type`, a line feed and the body, in quotes (HY-122.10)."""
    digest = hashlib.sha256(f"{content_type}\n{body}".encode("utf-8")).hexdigest()
    return f'"{digest[:32]}"'
