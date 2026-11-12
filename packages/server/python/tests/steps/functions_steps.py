# The steps of contracts/functions.json (HYC-24, template FUN-43 to FUN-47 and RT-5): the open of an application with the
# host functions of a case, which fails for the names that the case states, and the response to its request.
import contextlib
import io

from polyspec.hyper.request import Request
from polyspec.hyper.array_session import ArraySession

from ..render.render_functions import function_of, open_application


def cases(case) -> None:
    applications = case.input("applications")
    kinds = case.input("functionKinds")
    name = case.input("application")
    declared = case.input("functions")
    request = case.input("request")
    for kind in declared.values():
        if kind not in kinds:
            raise KeyError(f"undeclared function kind {kind!r}")
    functions = {key: function_of(kind) for key, kind in declared.items()}
    try:
        app = open_application(name, applications[name], functions)
    except Exception as error:
        if not case.has("openFails"):
            raise
        case.compare("openFails", error)
        case.compare("openError", str(error))
        return
    case.compare("openFails", None)
    store = ArraySession()
    # The server writes the cause of a 500 to stderr (HY-43); the case captures it, so that the report of the runner
    # holds only its own result.
    with contextlib.redirect_stderr(io.StringIO()):
        response = app.handle(
            Request(request["method"], Request.target_path(request["target"]), dict(request["headers"])),
            store,
        )
    case.compare("status", response.status)
    case.compare("body", response.body)
    case.compare("bodyContains", response.body)
