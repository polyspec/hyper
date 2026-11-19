"""The JSON text of the servers (HY-54): the text of a value with rules.json_write of the core, and the reading of a
JSON text with rules.json_read of the core."""

from __future__ import annotations

from ..app._core_rules import CoreRules


class JsonCodec:
    @staticmethod
    def encode(value: object) -> str:
        """Returns the JSON text of a value of the data model: rules.json_write of the core (HY-54.18, HY-54.19). A
        value that has no JSON form fails with the kind of the data model, as the core raises it (HY-44)."""
        return CoreRules.shared().json_codec_encode(value)

    @staticmethod
    def decode(text: str) -> object:
        """Reads a JSON text to a value of the data model with dictionaries in document order: rules.json_read of the
        core (HY-54.20). A text that json refuses fails with the kind ``malformed_json``, and a value outside the data
        model with the kind of the data model, as the core raises them (HY-54.21)."""
        return CoreRules.shared().json_codec_decode(text)
