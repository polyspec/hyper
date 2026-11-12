# The steps of contracts/hooks.json (HY-67, HY-97, HY-99): a hook that is not callable fails when the host entry is
# created, or when the application opens for the disconnect hook.
import tempfile

from polyspec.hyper.asgi import create_asgi
from polyspec.hyper.file_sessions import FileSessions
from polyspec.hyper.server import create_server
from polyspec.hyper.wsgi import create_wsgi

from . import client_steps
from .client_steps import Counter

_NO_FUNCTION = "no function"


def creation(case) -> None:
    """Gives a text in the place of the hook of the case to every entry that takes it, and records the error of the
    first; every entry must fail with exactly the open error, and the entries with one message."""
    hook = case.input("hook")
    with tempfile.TemporaryDirectory(prefix="hyper-hooks-") as directory:
        if hook == "disconnect":
            error = None
            try:
                client_steps._app(
                    directory, Counter(), None, {}, False, on_disconnect=_NO_FUNCTION
                )
            except Exception as failure:  # noqa: BLE001 - the reader checks the class of the error
                error = failure
            case.outcome("creation", error)
            case.compare("message", "" if error is None else str(error))
            return
        if hook not in ("around", "written"):
            raise LookupError(f"the hook {hook} of the case is unknown")
        application = client_steps._app(directory, Counter(), None, {}, False)
        sessions = FileSessions(directory)
        errors = []
        entries = {
            create_server: lambda: create_server(application, sessions, **{hook: _NO_FUNCTION}),
            create_wsgi: lambda: create_wsgi(application, sessions, **{hook: _NO_FUNCTION}),
            create_asgi: lambda: create_asgi(application, sessions, **{hook: _NO_FUNCTION}),
        }
        for entry, create in entries.items():
            try:
                created = create()
            except ValueError as failure:
                if type(failure) is not ValueError:
                    raise
                errors.append(failure)
            else:
                if entry is create_server:
                    created.server_close()
                raise LookupError(f"{entry.__name__} did not fail")
    if len({str(error) for error in errors}) != 1:
        raise LookupError("the messages of the entries differ")
    case.outcome("creation", errors[0])
    case.compare("message", str(errors[0]))
