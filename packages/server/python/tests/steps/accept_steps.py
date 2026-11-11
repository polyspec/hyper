# The steps of contracts/accept.json (HY-116): the parse of an Accept value and the selection of a media type.
from polyspec.hyper._accept import Accept
from polyspec.hyper._invalid_accept import InvalidAccept


def parse(case) -> None:
    value = case.input("accept")
    try:
        ranges = Accept.parse(value)
    except InvalidAccept:
        case.compare("invalid", True)
        return
    case.compare(
        "ranges",
        [
            {
                "type": item.type,
                "subtype": item.subtype,
                "parameters": [list(pair) for pair in item.parameters],
                "weight": item.weight,
            }
            for item in ranges
        ],
    )


def select(case) -> None:
    value = case.input("accept")
    types = case.input("types")
    try:
        selected = Accept.select(value, types)
    except InvalidAccept:
        case.compare("invalid", True)
        return
    case.compare("selected", selected)
