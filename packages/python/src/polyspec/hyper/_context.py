"""The context of an application (HY-124 to HY-128): the map that its handler returns, its JSON text (HY-54), its
hash with the build (HY-125), the member `context` of a JSON response, the check of the `Hyper-Context` header and
the place of the context in the shared data of a document (HY-10)."""

from __future__ import annotations

import hashlib
import re
from typing import Callable, Optional

from ._data_model import DataModel
from ._hyper_value_error import HyperValueError
from ._json_codec import JsonCodec


class Context:
    @staticmethod
    def held(handler: Callable[[object], object], selection: object) -> dict:
        """Calls the context handler with the selection value and returns its map, which belongs to the data model;
        a value that is not a map, or that holds a value outside the data model, fails (HY-124, HY-44, HY-43)."""
        value = handler(selection)
        if not isinstance(value, dict):
            raise TypeError("the context handler did not return a map (HY-124)")
        DataModel.check({"context": value})
        return value

    @staticmethod
    def text(map: dict) -> str:
        """Returns the JSON text of HY-54 of a context map."""
        return JsonCodec.encode(map)

    @staticmethod
    def hash(build: str, text: str) -> str:
        """Returns the context hash: the lowercase hexadecimal SHA-256 digest of `{"build":"<build id>","context":`,
        the JSON text of the context and `}` (HY-125)."""
        signed = '{"build":"' + build + '","context":' + text + "}"
        return hashlib.sha256(signed.encode("utf-8")).hexdigest()

    @staticmethod
    def member(build: str, map: dict, held: Optional[str]) -> dict:
        """Returns the member `context` of a JSON response (HY-128): `hash`, and `value` unless the held hash of the
        request equals the hash (HY-127). A document that embeds its data passes None, so it always has the value."""
        hash = Context.hash(build, Context.text(map))
        return {"hash": hash} if held == hash else {"hash": hash, "value": map}

    @staticmethod
    def valid_header(value: Optional[str]) -> bool:
        """Returns True for a request without `Hyper-Context` or with a context hash, 64 lowercase hexadecimal
        (HY-127)."""
        return value is None or re.fullmatch(r"[0-9a-f]{64}", value) is not None

    @staticmethod
    def with_context(shared: dict, map: dict) -> dict:
        """Returns the shared data of a document with the context in its place (HY-10): after `csrf`, and when HY-73
        removed `csrf`, right after `title`; and first when they removed both. Shared data that already holds a
        member `context` fails with the kind `shared_holds_context` (HY-124.8, HY-132), because the context has one
        place and one source (HY-124, HY-128)."""
        if "context" in shared:
            raise HyperValueError(
                "shared_holds_context",
                "the shared data already holds the member context (HY-128)",
            )
        anchor = "csrf" if "csrf" in shared else "title"
        placed: dict = {}
        found = False
        for name, value in shared.items():
            placed[name] = value
            if name == anchor:
                placed["context"] = map
                found = True
        return placed if found else {"context": map, **placed}
