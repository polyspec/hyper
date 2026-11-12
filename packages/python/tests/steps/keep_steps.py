# The steps of contracts/keep.json (HY-38): the data that a case keeps, and the kept values that the server sends.
import copy

from polyspec.hyper._kept import Kept


def _pairs(case) -> list:
    return [(pair[0], pair[1]) for pair in case.input("kept")]


def cases(case) -> None:
    case.compare("expected", Kept.apply(case.input("data"), _pairs(case)))


def select(case) -> None:
    data = case.input("data")
    before = copy.deepcopy(data)
    case.compare("selected", Kept.select(data, _pairs(case)))
    case.compare("unchanged", data == before)
