# The steps of contracts/json.json (HY-17, HY-38, HY-40, HY-44): the encoding and the decoding of JSON text.
from polyspec.hyper._json_codec import JsonDecodeError, decode, encode, in_data_model


def finite(value):
    """A decoded value with the numbers outside the data model as floats, which encoding also writes."""
    if isinstance(value, list):
        return [finite(item) for item in value]
    if isinstance(value, dict):
        return {key: finite(item) for key, item in value.items()}
    return float(value.literal) if hasattr(value, "literal") else value


def decode_result(text: str) -> str:
    try:
        return "value" if in_data_model(decode(text)) else "outside"
    except JsonDecodeError:
        return "error"


def encode_text(case) -> None:
    case.compare("expected", encode(finite(decode(case.input("json")))))


def decode_text(case) -> None:
    case.compare("result", decode_result(case.input("json")))
