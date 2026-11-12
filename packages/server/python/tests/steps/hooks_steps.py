# The steps of contracts/hooks.json (HY-67, HY-97, HY-99): a hook that is not callable fails when the host entry is
# created, or when the application opens for the disconnect hook.
import tempfile

from polyspec.hyper.asgi import create_asgi
from polyspec.hyper.file_sessions import FileSessions
from polyspec.hyper.server import create_server
from polyspec.hyper.wsgi import create_wsgi

from ..render.fixture_handlers import Counter, fixture_app

_NO_FUNCTION = "no function"


def creation(case) -> None:
    """Gives a text in the place of the hook of the case to every entry that takes it, and records the error of the
    first; every entry must fail with exactly the open error."""
    hook = case.input("hook")
    if hook == "disconnect":
        error = None
        try:
            fixture_app(Counter(), on_disconnect=_NO_FUNCTION)
        except Exception as failure:  # noqa: BLE001 - the reader checks the class of the error
            error = failure
        case.outcome("creation", error)
        return
    if hook not in ("around", "written"):
        raise LookupError(f"the hook {hook} of the case is unknown")
    application = fixture_app(Counter())
    errors = []
    with tempfile.TemporaryDirectory(prefix="hyper-hooks-") as directory:
        sessions = FileSessions(directory)
        for entry in (create_server, create_wsgi, create_asgi):
            try:
                created = entry(application, sessions, **{hook: _NO_FUNCTION})
            except ValueError as failure:
                if type(failure) is not ValueError:
                    raise
                errors.append(failure)
            else:
                if entry is create_server:
                    created.server_close()
                raise LookupError(f"{entry.__name__} did not fail")
    case.outcome("creation", errors[0])
