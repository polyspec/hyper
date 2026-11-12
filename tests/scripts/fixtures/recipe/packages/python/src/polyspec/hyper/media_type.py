"""The media type of HY-2."""

from __future__ import annotations

from polyspec.hyper._csrf import Csrf
from polyspec.hyper._json_codec import JsonCodec


class MediaType:
    def __init__(self) -> None:
        pass

    @staticmethod
    def parse(text: str) -> MediaType:
        JsonCodec.decode(text)
        return MediaType()

    def essence(self) -> str:
        return self._folded(Csrf("k"))

    def _folded(self, csrf: Csrf) -> str:
        return csrf.raw()
