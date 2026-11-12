# The steps of contracts/file-sessions.json (HY-45, HY-72, HY-104): the requests of a store of session files over a
# temporary directory of the case, the session cookie, and the options that making the store refuses.
import os
import tempfile
import time
from pathlib import Path

from polyspec.hyper.session._record_session import RecordSession
from polyspec.hyper.session.file_sessions import FileSessions
from polyspec.php_serialize import UnserializeError

from .store_requests import StoreRequests

_PREFIX = "sess_"


def requests(case) -> None:
    files = case.input("files") if case.has("files") else []
    with tempfile.TemporaryDirectory(prefix="hyper-sessions-") as directory:
        start = time.time()
        aged: dict[str, float] = {}
        for entry in files:
            file = Path(directory) / f"{_PREFIX}{entry['identifier']}"
            descriptor = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            try:
                os.write(descriptor, entry["bytes"].encode("latin-1"))
            finally:
                os.close(descriptor)
            if "age" in entry:
                os.utime(file, (start - entry["age"], start - entry["age"]))
                aged[file.name] = start - entry["age"] / 2
        store = FileSessions(directory)
        run = StoreRequests(
            store._open,
            _failure_class,
            {"directory": lambda: sorted(_names(directory, run.identifiers).values())},
            [entry["identifier"] for entry in files],
        )
        records = []
        touched = []
        for step in case.input("steps"):
            if step.get("collect") is True:
                run.collected(store._collect())
            else:
                run.request(step)
            names = _names(directory, run.identifiers)
            records.append(
                sorted(
                    [written, (Path(directory) / name).read_bytes().decode("latin-1")]
                    for name, written in names.items()
                )
            )
            touched.append(
                sorted(
                    written
                    for name, written in names.items()
                    if name in aged
                    and (Path(directory) / name).stat().st_mtime > aged[name]
                )
            )
    case.compare("results", run.results)
    case.compare("created", run.created)
    case.compare("errors", run.errors)
    case.compare("message", run.message)
    case.compare("records", records)
    case.compare("touched", touched)


def cookie(case) -> None:
    https = case.input("https")
    identifier = case.input("identifier")
    case.compare("name", RecordSession.cookie_name(https))
    case.compare("header", RecordSession.cookie_header(identifier, https))


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


def _failure_class(error: Exception) -> str | None:
    if isinstance(error, UnserializeError):
        return "unserialize"
    return "record" if type(error) is ValueError else None


def _names(directory: str, identifiers: list) -> dict[str, str]:
    """The file names of the directory, each with the name that the case writes: `sess_#n` for the file of the
    identifier that step n created."""
    created = {
        f"{_PREFIX}{identifier}": f"{_PREFIX}#{number}"
        for number, identifier in enumerate(identifiers)
        if identifier is not None
    }
    return {name: created.get(name, name) for name in os.listdir(directory)}
