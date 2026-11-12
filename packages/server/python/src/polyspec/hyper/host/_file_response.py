"""A file of the public directory that a transport callable serves before `around` (HY-100)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class FileResponse:
    """The media type of a file of the public directory, the number of its bytes and the bytes that the response
    carries, which are none for a HEAD request (HY-27.5)."""

    content_type: str
    length: int
    data: bytes
