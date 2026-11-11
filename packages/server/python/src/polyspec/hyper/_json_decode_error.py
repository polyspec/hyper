"""The error of a JSON text that does not decode as PHP ``json_decode`` reads it (HY-54)."""

from __future__ import annotations


class JsonDecodeError(ValueError):
    """A JSON text that does not decode as PHP ``json_decode`` reads it (HY-54)."""
