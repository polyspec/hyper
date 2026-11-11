# The steps of contracts/reads.json (HY-73): the data that a template keeps, by the reads that the case states.
from polyspec.hyper._reads import Reads


def cases(case) -> None:
    case.compare("kept", Reads.keep(case.input("data"), case.input("reads")))
