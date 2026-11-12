# The steps of tests/legacy/file-store-sessions.json (HY-45, HY-104): the fixed copy of the store cases that the sessions
# library holds, which the server reads until it calls the core and S-4 removes the copy; the requests run as those of
# contracts/file-sessions.json, and the options that the store refuses give the open error.
import tempfile

from polyspec.hyper.file_sessions import FileSessions

from . import file_sessions_steps


def requests(case) -> None:
    file_sessions_steps.requests(case)


def open(case) -> None:
    """Makes the store with the directory and the lifetime of the case and compares the message of the open error."""
    with tempfile.TemporaryDirectory(prefix="hyper-sessions-") as temporary:
        directory = case.input("directory")
        options = {"lifetime": case.input("lifetime")} if case.has("lifetime") else {}
        try:
            FileSessions(
                temporary if directory == "temporary" else directory, **options
            )
        except ValueError as error:
            if type(error) is not ValueError:
                raise
            case.compare("error", str(error))
            return
    raise LookupError("making the store did not fail")
