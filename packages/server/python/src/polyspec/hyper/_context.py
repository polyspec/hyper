"""The context of an application: its JSON text, the context hash of the build (HY-125) and the check of the
`Hyper-Context` header (HY-127)."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

from . import _json_codec

_HASH = re.compile(r"[0-9a-f]{64}")


@dataclass(frozen=True)
class Context:
    """A context that the context handler returned for one request: the map, its JSON text (HY-54) and its hash."""

    value: dict
    text: str
    hash: str


def text_of(value: dict) -> str:
    """Returns the JSON text of a context map (HY-54)."""
    return _json_codec.encode(value)


def signed_text(build: str, text: str) -> str:
    """Returns the bytes that the context hash digests: `{"build":"<build id>","context":`, the JSON text of the
    context and `}` (HY-125)."""
    return '{"build":"' + build + '","context":' + text + "}"


def hash_of(build: str, value: dict) -> str:
    """Returns the context hash of a context map under a build id: the lowercase hexadecimal SHA-256 digest of
    `signed_text` (HY-125)."""
    return hashlib.sha256(signed_text(build, text_of(value)).encode("utf-8")).hexdigest()


def of(value: dict, build: str) -> Context:
    """Returns the context of a map under a build id, with its JSON text and its hash (HY-124, HY-125)."""
    text = text_of(value)
    digest = hashlib.sha256(signed_text(build, text).encode("utf-8")).hexdigest()
    return Context(value, text, digest)


def valid_header(value: str) -> bool:
    """Returns True when a `Hyper-Context` value is 64 lowercase hexadecimal characters (HY-127)."""
    return _HASH.fullmatch(value) is not None
