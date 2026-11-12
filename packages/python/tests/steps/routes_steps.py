# The steps of contracts/routes.json (HY-13, HY-18 to HY-20): the match of a path, also under the base path, and
# refused paths; rest_steps.py runs the same match and refusal for contracts/rest.json.
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
    except Exception as error:  # noqa: BLE001 - the reader checks the class of the error
        raised = error
    else:
        raised = None
    case.outcome("router", raised)
