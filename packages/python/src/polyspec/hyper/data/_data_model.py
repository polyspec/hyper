"""The values of the template data model that handlers give the server (HY-44). The core judges a value: the binding
converts it and the core checks it, and a value outside the data model fails with the kind and the message of the
core (HY-44.12, HY-133.3). The server writes no message of its own."""

from __future__ import annotations

from ..app._core_rules import CoreRules

# The kinds of a failure (HY-44.8), the kinds of the template data model.
_KINDS = frozenset(
    (
        "data_number_range",
        "data_number_not_finite",
        "data_invalid_utf8",
        "data_depth",
        "data_unsupported_type",
    )
)


class DataModel:
    @staticmethod
    def check(value: object) -> object:
        """Fails with the error of its kind when a value is not a value of the data model, and returns the value. The
        core checks the value as it writes its JSON text, which every value of the data model has (HY-54.19)."""
        CoreRules.shared().json_codec_encode(value)
        return value

    @staticmethod
    def contains(value: object) -> bool:
        """Returns True for a value of the data model; for example, integers outside ±(2^53 − 1) are not."""
        try:
            DataModel.check(value)
            return True
        except (ValueError, TypeError) as error:
            # HY-44.8: only a kind of the data model is a value outside it; another failure is not swallowed.
            if getattr(error, "kind", None) not in _KINDS:
                raise
            return False
