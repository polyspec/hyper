# The steps of contracts/accept.json (HY-116): the parse of an Accept value and the selection of a media type.
from polyspec.hyper.representation._accept import Accept

from ..case_rules import FAILURES, raises_of


def parse(case) -> None:
    value = case.input("accept")
    ranges = None
    raises = None
    try:
        ranges = [
            {
                "type": item.type,
                "subtype": item.subtype,
                "parameters": [list(pair) for pair in item.parameters],
                "weight": item.weight,
            }
            for item in Accept.parse(value)
        ]
    except FAILURES as failure:
        raises = raises_of(failure)
    case.compare("ranges", ranges)
    case.compare("raises", raises)


def select(case) -> None:
    value = case.input("accept")
    types = case.input("types")
    selected = None
    raises = None
    try:
        # The selection that the servers make: the ranges of the value, then the best of the types (HY-116).
        selected = Accept.best(Accept.parse(value), types)[0]
    except FAILURES as failure:
        raises = raises_of(failure)
    case.compare("selected", selected)
    case.compare("raises", raises)
