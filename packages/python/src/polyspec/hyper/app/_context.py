"""The context of an application (HY-124 to HY-128): the map that its handler returns, its hash with the build
(HY-125) and the check of the `Hyper-Context` header (HY-127); the core places the context in the shared data
of a document (HY-10)."""

from __future__ import annotations

from typing import Callable, Optional

from ._core_rules import core_rules


class Context:
    @staticmethod
    def held(handler: Callable[[object], object], selection: object) -> dict:
        """Calls the context handler with the selection value and returns its map; a value that is not a map fails
        (HY-124, HY-43). The core checks that the map belongs to the data model (HY-44)."""
        value = handler(selection)
        if not isinstance(value, dict):
            raise TypeError("the context handler did not return a map (HY-124)")
        return value

    @staticmethod
    def hash(build: str, text: str) -> str:
        """Returns the context hash: the lowercase hexadecimal SHA-256 digest of `{"build":"<build id>","context":`,
        the JSON text of the context and `}` (HY-125); the core computes it (HY-133.2)."""
        return core_rules().context_hash(build, text)

    @staticmethod
    def valid_header(value: Optional[str]) -> bool:
        """Returns True for a request without `Hyper-Context` or with a context hash, 64 lowercase hexadecimal
        (HY-127); the core checks it (HY-133.2)."""
        return core_rules().context_valid_header(value)
