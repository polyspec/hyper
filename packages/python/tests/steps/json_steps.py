# The steps of contracts/json.json (HY-17, HY-54): the JSON text of a decoded value, and the decoding of a text.
from polyspec.hyper.data._json_codec import JsonCodec
from polyspec.hyper.data._outside_number import OutsideNumber

from ..case_rules import FAILURES, raises_of


def _finite(value):
    """A decoded value with the numbers outside the data model as floats, which encoding also writes."""
    if isinstance(value, list):
        return [_finite(item) for item in value]
    if isinstance(value, dict):
        return {key: _finite(item) for key, item in value.items()}
    return _outside(value) if isinstance(value, OutsideNumber) else value


def _outside(value: OutsideNumber) -> float:
    """A number outside the data model as a float."""
    return float(value.literal)


def encode(case) -> None:
    text = case.input("json")
    expected = None
    raises = None
    try:
        expected = JsonCodec.encode(_finite(JsonCodec.decode(text)))
    except FAILURES as failure:
        raises = raises_of(failure)
    case.compare("expected", expected)
    case.compare("raises", raises)


def decode(case) -> None:
    text = case.input("json")
    result = None
    raises = None
    try:
        JsonCodec.decode(text)
        result = "value"
    except FAILURES as failure:
        raises = raises_of(failure)
    case.compare("result", result)
    case.compare("raises", raises)
