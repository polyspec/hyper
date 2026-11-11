# The steps of contracts/keep.json (HY-38): the data that a case keeps.
from polyspec.hyper._kept import apply


def cases(case) -> None:
    kept = [(pair[0], pair[1]) for pair in case.input("kept")]
    case.compare("expected", apply(case.input("data"), kept))
