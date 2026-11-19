# The steps of fields.json and forms.json of the pinned http-form release (HY-56, HY-57, HY-113, HY-131; H35.11): the
# cases are in the case form of binding, a text and a body being `{"hex": ...}`, and the server reads each through the
# core, as a request does.
import os
import shutil
import tempfile

from polyspec.hyper.app._core_rules import core_rules

from ..case_rules import raises_of
from polyspec.hyper.form._core_body import NO_LIMIT, RequestBody, body_form
from polyspec.hyper.form._fields import Fields
from polyspec.hyper.form._files import Files
from polyspec.hyper.form.uploaded_file import UploadedFile

# The base classes of the error classes of hyper (HY-133.2): a step records an error of these classes, which raises_of
# reads, and every other error fails the case where it is raised.
HYPER_BASES = (ValueError, TypeError, OSError, RuntimeError)


def urlencoded(case) -> None:
    """Parses the text as Fields.parse does, and records its pairs and its names, or the failure of http-form (HY-56,
    HY-57, HY-42)."""
    text = _bytes(case, "text")
    failure = _raised(lambda: core_rules().parse_urlencoded(text))
    fields = Fields.parse(text)
    _compare_raises(case, failure)
    if fields is not None:
        case.compare("fields", _fields_of(fields))
        case.compare("names", fields.names())


def multipart(case) -> None:
    """Reads a body held as one value as a request does, and records its form values and its files, or the failure of
    http-form, so that a part without a name fails the body (HY-57, HY-113.21, HY-113.23, HY-113.25)."""
    content_type = _text(case, "content_type")
    body = _bytes(case, "body")
    rules = core_rules()
    limits = rules.body_limits(NO_LIMIT, NO_LIMIT, NO_LIMIT, NO_LIMIT)
    form = None
    failure = None
    try:
        form = body_form(rules.read_held_body(content_type or None, body, limits))
    except HYPER_BASES as error:
        failure = error
    _compare_raises(case, failure)
    if form is not None:
        case.compare("fields", _fields_of(form[0]))
        case.compare("files", _files_of(form[1], sized=False))


def streamed(case) -> None:
    """Reads the body in chunks as a host does, and records what the body holds, its parts, the files of its
    directory, the move of its first file and the removal of the directory (HY-131)."""
    content_type = _text(case, "content_type")
    body = _bytes(case, "body")
    chunk = case.input("chunk")
    limits = case.input("limits")
    move = _text(case, "move")
    if not isinstance(chunk, int) or chunk < 1 or not isinstance(limits, dict):
        raise LookupError("the chunk or the limits of the case are not given")
    read = RequestBody(
        content_type,
        limits["limit"],
        case.input("stream") is True,
        limits["value_limit"],
        limits["part_limit"],
        limits["file_limit"],
    )
    scratch = tempfile.mkdtemp(prefix="hyper-case-")
    try:
        stopped = False
        at = 0
        while at < len(body) and not stopped:
            stopped = not read.feed(body[at : at + chunk])
            at += chunk
        held = read.held()
        if read.streamed():
            parts = read.parts()
        else:
            parts = (
                None
                if stopped
                else (
                    Fields.from_body(content_type, held),
                    Files.from_body(content_type, held),
                )
            )
            if parts is not None and (parts[0] is None or parts[1] is None):
                parts = None
        directory = read.directory()

        def count():
            return None if directory is None else len(os.listdir(directory))

        _compare_raises(case, read.failure())
        case.compare("stopped", stopped)
        case.compare("exceeded", read.exceeded())
        case.compare("held", held.decode("latin-1"))
        case.compare("fields", None if parts is None else _fields_of(parts[0]))
        case.compare(
            "files", None if parts is None else _files_of(parts[1], sized=True)
        )
        case.compare("entries", count())
        pairs = [] if parts is None else parts[1].pairs()
        if move == "none" or not pairs:
            case.compare("moved", None)
        else:
            first: UploadedFile = pairs[0][1][0]
            target = os.path.join(scratch, "target")
            if move == "exists":
                with open(target, "wb") as taken:
                    taken.write(b"taken")
            failed = _failure(lambda: first.move_to(7 if move == "type" else target))
            after = None
            if failed is None:
                with open(target, "rb") as moved:
                    content = moved.read().decode("latin-1")
                failed = _failure(
                    lambda: first.move_to(os.path.join(scratch, "second"))
                )
                read_failure = _failure(first.content)
                after = None if read_failure is None else read_failure[0]
            else:
                content = first.content().decode("latin-1")
            case.compare(
                "moved",
                {
                    "content": content,
                    "left": count(),
                    "again": None if failed is None else failed[0],
                    "read": after,
                    "class": None if failed is None else failed[1],
                },
            )
        read.remove()
        case.compare(
            "removed", None if directory is None else not os.path.isdir(directory)
        )
    finally:
        read.remove()
        shutil.rmtree(scratch)


def _raised(work):
    """Runs the work and returns the error that it raised, or None."""
    try:
        work()
        return None
    except HYPER_BASES as error:
        return error


def _compare_raises(case, failure) -> None:
    """Compares the failure of http-form, its kind, its status, its category and its message, with `raises`; an
    error that is no error of hyper is raised again (`raises_of`)."""
    case.compare("raises", None if failure is None else raises_of(failure))


def _failure(work):
    """Runs the work and returns the message and the class of its failure, ``type`` for a TypeError and ``value`` for
    the class of the category value, or None when it does not fail."""
    try:
        work()
        return None
    except TypeError as error:
        return (str(error), "type")
    except ValueError as error:
        return (str(error), "value")


def _fields_of(fields):
    return [list(pair) for pair in fields.pairs()]


def _files_of(files, sized: bool):
    return [
        {
            "name": item.name(),
            "filename": item.filename(),
            "contentType": item.content_type(),
            "content": item.content().decode("latin-1"),
            **({"size": item.size()} if sized else {}),
        }
        for _, items in files.pairs()
        for item in items
    ]


def _bytes(case, name: str) -> bytes:
    value = case.input(name)
    if not isinstance(value, dict) or not isinstance(value.get("hex"), str):
        raise LookupError(f"the case field {name} is not a {{hex}} value")
    return bytes.fromhex(value["hex"])


def _text(case, name: str) -> str:
    value = case.input(name)
    if not isinstance(value, str):
        raise LookupError(f"the case field {name} is not a string")
    return value
