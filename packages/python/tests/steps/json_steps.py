# The steps of contracts/json.json (HY-17, HY-54): the JSON text of a decoded value, and the decoding of a text.
from polyspec.hyper.data._json_codec import JsonCodec

from ..case_rules import FAILURES, raises_of


def encode(case) -> None:
    text = case.input("json")
    expected = None
    raises = None
    try:
        expected = JsonCodec.encode(JsonCodec.decode(text))
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
