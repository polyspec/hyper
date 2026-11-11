# The steps of contracts/rest.json (HY-13, HY-18 to HY-20): the match of a path of a REST route, and refused paths.
from polyspec.hyper._router import Router


def cases(case) -> None:
    case.compare("result", Router(case.input("routes")).match(case.input("path")))


def invalid_paths(case) -> None:
    try:
        Router([{"name": "x", "path": case.input("path")}])
    except ValueError:
        raised = True
    else:
        raised = False
    case.outcome("router", raised)
