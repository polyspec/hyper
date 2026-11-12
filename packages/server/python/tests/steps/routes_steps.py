# The steps of contracts/routes.json (HY-13, HY-18 to HY-20): the match of a path, under the base path and refused paths.
from polyspec.hyper._router import Router


def cases(case) -> None:
    case.compare("result", Router(case.input("routes")).match(case.input("path")))


def base_cases(case) -> None:
    path = Router.strip_base_path(case.input("path"), case.input("basePath"))
    router = Router(case.input("routes"))
    case.compare("result", None if path is None else router.match(path))


def invalid_paths(case) -> None:
    try:
        Router([{"name": "x", "path": case.input("path")}])
    except Exception as error:
        raised = error
    else:
        raised = None
    case.outcome("router", raised)
