"""The JSON text of the servers (HY-17, HY-54): the JSON response value, its text with the bytes of PHP
``json_encode`` with ``JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES``, and the reading of a JSON text with
rules.json_read of the core."""

from __future__ import annotations

import math
import re
from decimal import Decimal
from typing import Optional

from ..app._core_rules import core_rules

# A number of the data model is within ±(2^53 − 1).
_MAX_SAFE = 9007199254740991

_ESCAPES = {
    '"': '\\"',
    "\\": "\\\\",
    "\b": "\\b",
    "\f": "\\f",
    "\n": "\\n",
    "\r": "\\r",
    "\t": "\\t",
    " ": "\\u2028",
    " ": "\\u2029",
}
_ESCAPED = re.compile('["\\\\\x00-\x1f  ]')


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
        """Returns the JSON text of a value of the data model as PHP ``json_encode`` writes it; a string with a lone
        surrogate, a number that is not finite or a value outside the data model fails (HY-44)."""
        if value is None:
            return "null"
        if isinstance(value, bool):
            return "true" if value else "false"
        if isinstance(value, (int, float)):
            return JsonCodec._encode_number(value)
        if isinstance(value, str):
            return JsonCodec._encode_string(value)
        if isinstance(value, list):
            return "[" + ",".join(JsonCodec.encode(item) for item in value) + "]"
        if isinstance(value, dict):
            items = (
                f"{JsonCodec._encode_string(key)}:{JsonCodec.encode(item)}"
                for key, item in value.items()
            )
            return "{" + ",".join(items) + "}"
        raise TypeError("hyper: the value is not a value of the data model")

    @staticmethod
    def decode(text: str) -> object:
        """Reads a JSON text to a value of the data model with dictionaries in document order: rules.json_read of the
        core (HY-54.20). A text that json refuses fails with the kind ``malformed_json``, and a value outside the data
        model with the kind of the data model, as the core raises them (HY-54.21)."""
        return core_rules().json_codec_decode(text)

    @staticmethod
    def _encode_number(value: int | float) -> str:
        """Writes an integer within ±(2^53 − 1) in decimal and another number with the shortest digits that read back
        as the same number: positional when the decimal point position is between -3 and 17, and otherwise
        ``d.ddde±x`` with at least one fraction digit; negative zero is ``-0`` (HY-54)."""
        number = float(value)
        if not math.isfinite(number):
            raise ValueError("hyper: a number that is not finite has no JSON text")
        if number == 0:
            return "-0" if math.copysign(1.0, number) < 0 else "0"
        if number.is_integer() and abs(number) <= _MAX_SAFE:
            return str(int(number))
        # Decimal(repr(value)) holds the shortest digits that read back as the same float.
        _, digits_tuple, exponent = Decimal(repr(abs(number))).normalize().as_tuple()
        digits = "".join(str(digit) for digit in digits_tuple)
        point = int(exponent) + len(digits_tuple)
        if point < -3 or point > 17:
            power = point - 1
            text = f"{digits[0]}.{digits[1:] or '0'}e{'-' if power < 0 else '+'}{abs(power)}"
        elif point <= 0:
            text = "0." + "0" * -point + digits
        elif len(digits) <= point:
            text = digits + "0" * (point - len(digits))
        else:
            text = digits[:point] + "." + digits[point:]
        return f"-{text}" if number < 0 else text

    @staticmethod
    def _encode_string(text: str) -> str:
        """Escapes the quote, the backslash, the control characters below U+0020 and the line and paragraph separators
        U+2028 and U+2029; every other character, including ``/`` and DEL, stays as it is (HY-54)."""
        JsonCodec._check_well_formed(text)
        return (
            '"'
            + _ESCAPED.sub(
                lambda match: (
                    _ESCAPES.get(match.group(0)) or f"\\u{ord(match.group(0)):04x}"
                ),
                text,
            )
            + '"'
        )

    @staticmethod
    def _check_well_formed(text: str) -> None:
        """Fails for a string with a lone surrogate, which has no UTF-8 form."""
        if any(0xD800 <= ord(char) <= 0xDFFF for char in text):
            raise ValueError("hyper: a string with a lone surrogate is not UTF-8")
