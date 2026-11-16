"""The JSON text of the servers (HY-17, HY-54): the JSON response value, its text with rules.json_write of the core,
and the reading of a JSON text with rules.json_read of the core."""

from __future__ import annotations

from typing import Optional

from ..app._core_rules import core_rules


class JsonCodec:
    @staticmethod
    def value(
        timezone: str,
        route: str,
        params: dict,
        build: str,
        context: Optional[dict],
        shared: dict,
        regions: dict,
        kept: dict,
    ) -> dict:
        """Returns the JSON response value of a page (HY-17, HY-128): `build` is the build id and `context` the
        member `context` of HY-128 when the response has one, both after `params`; `regions` holds the loader data by
        region name and `kept` the kept values by region name and path."""
        result: dict = {
            "env": {"timezone": timezone},
            "route": route,
            "params": params,
            "build": build,
        }
        if context is not None:
            result["context"] = context
        result.update({"shared": shared, "regions": regions, "kept": kept})
        return result

    @staticmethod
    def encode(value: object) -> str:
        """Returns the JSON text of a value of the data model: rules.json_write of the core (HY-54.18, HY-54.19). A
        value that has no JSON form fails with the kind of the data model, as the core raises it (HY-44)."""
        return core_rules().json_codec_encode(value)

    @staticmethod
    def decode(text: str) -> object:
        """Reads a JSON text to a value of the data model with dictionaries in document order: rules.json_read of the
        core (HY-54.20). A text that json refuses fails with the kind ``malformed_json``, and a value outside the data
        model with the kind of the data model, as the core raises them (HY-54.21)."""
        return core_rules().json_codec_decode(text)
