# The steps of contracts/json.json (HY-17, HY-54): the JSON text of a decoded value, and the decoding of a text.
from polyspec.hyper._json_codec import JsonCodec
from polyspec.hyper._json_decode_error import JsonDecodeError
from polyspec.hyper._outside_number import OutsideNumber


def _finite(value):
    """A decoded value with the numbers outside the data model as floats, which encoding also writes."""
    if isinstance(value, list):
        return [_finite(item) for item in value]
    if isinstance(value, dict):
        return {key: _finite(item) for key, item in value.items()}
    return float(value.literal) if isinstance(value, OutsideNumber) else value


def encode(case) -> None:
    case.compare(
        "expected", JsonCodec.encode(_finite(JsonCodec.decode(case.input("json"))))
    )


def decode(case) -> None:
    try:
        result = (
            "value"
            if JsonCodec.in_data_model(JsonCodec.decode(case.input("json")))
            else "outside"
        )
    except JsonDecodeError:
        result = "error"
    case.compare("result", result)
