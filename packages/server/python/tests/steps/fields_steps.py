# The steps of contracts/fields.json (HY-56, HY-57, HY-113): a urlencoded text is the UTF-8 encoding of its JSON
# string, and a multipart type and body are text whose characters are their bytes.
from polyspec.hyper.form._fields import Fields
import os
import shutil
import tempfile

from polyspec.hyper.form._files import Files
from polyspec.hyper.form._multipart import Multipart
from polyspec.hyper.form._request_body import RequestBody
from polyspec.hyper.form.uploaded_file import UploadedFile


def urlencoded(case) -> None:
    """Parses the text and records its pairs and its names, or None for both when it fails with HY-42 (HY-56)."""
    fields = Fields.parse(_text(case, "text").encode("utf-8"))
    case.compare(
        "fields", None if fields is None else [list(pair) for pair in fields.pairs()]
    )
    case.compare("names", None if fields is None else fields.names())


def multipart(case) -> None:
    """Reads the form values and the files of the body, or None for each when the body fails with HY-42 (HY-57,
    HY-113)."""
    kind = _text(case, "type").encode("latin-1").decode("latin-1")
    body = _text(case, "body").encode("latin-1")
    whole = [
        _fields_of(Fields.from_body(kind, body)),
        _files_of(Files.from_body(kind, body)),
    ]
    # HY-131.6: the body read in two chunks, divided at every position, gives the result of the whole body, and the
    # reader holds between two chunks at most its bound; the first division that differs is the result of the case.
    boundary = Multipart.boundary(kind)
    result = whole
    if boundary is not None:
        bound = max(8192 + 3, len(boundary) + 3)
        for at in range(len(body) + 1):
            parts = Multipart(boundary, None, None, None, None)
            for chunk in (body[:at], body[at:]):
                parts.feed(chunk)
                if parts.buffered() > bound:
                    raise AssertionError(
                        f"the reader holds {parts.buffered()} bytes after a chunk that ends at {at}; its bound is {bound}"
                    )
            read = parts.result()
            divided = [
                _fields_of(None if read is None else read[0]),
                _files_of(None if read is None else read[1]),
            ]
            if divided != whole:
                result = divided
                break
    case.compare("fields", result[0])
    case.compare("files", result[1])


def streamed(case) -> None:
    """Reads the body in chunks as a host does, and records what the body holds, its parts, the files of its
    directory, the move of its first file and the removal of the directory (HY-131)."""
    kind = _text(case, "type")
    body = _text(case, "body").encode("latin-1")
    chunk = case.input("chunk")
    limit = case.input("limit")
    move = _text(case, "move")
    if not isinstance(chunk, int) or chunk < 1 or not isinstance(limit, int):
        raise LookupError("the chunk or the limit of the case is not a number")
    limits = [
        case.input("valueLimit"),
        case.input("partLimit"),
        case.input("fileLimit"),
    ]
    if not all(isinstance(value, int) for value in limits):
        raise LookupError("a limit of the case is not a number")
    read = RequestBody(kind, limit, case.input("stream") is True, *limits)
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
            fields = None if parts is None else parts[0]
            files = None if parts is None else parts[1]
        else:
            fields = None if stopped else Fields.from_body(kind, held)
            files = None if stopped else Files.from_body(kind, held)
        directory = read.directory()

        def count():
            return None if directory is None else len(os.listdir(directory))

        case.compare("stopped", stopped)
        case.compare("exceeded", read.exceeded())
        case.compare("held", held.decode("latin-1"))
        case.compare("fields", _fields_of(fields))
        case.compare(
            "files",
            None
            if files is None
            else [
                {
                    "name": item.name(),
                    "filename": item.filename(),
                    "contentType": item.content_type(),
                    "content": item.content().decode("latin-1"),
                    "size": item.size(),
                }
                for _, items in files.pairs()
                for item in items
            ],
        )
        case.compare("entries", count())
        pairs = [] if files is None else files.pairs()
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


def uploaded(case) -> None:
    """Makes a file with the public constructor, its content being the bytes of the characters of `content`, and
    compares its four parts and its size (HY-113.3)."""
    made = UploadedFile(
        _text(case, "name"),
        _text(case, "filename"),
        _text(case, "contentType"),
        _text(case, "content").encode("latin-1"),
    )
    case.compare(
        "file",
        {
            "name": made.name(),
            "filename": made.filename(),
            "contentType": made.content_type(),
            "size": made.size(),
            "content": made.content().decode("latin-1"),
        },
    )


def _failure(work):
    """Runs the work and returns the message and the class of its failure, ``type`` for a TypeError and ``value`` for
    the class of HY-46.2, or None when it does not fail."""
    try:
        work()
        return None
    except TypeError as error:
        return (str(error), "type")
    except ValueError as error:
        return (str(error), "value")


def _fields_of(fields):
    return None if fields is None else [list(pair) for pair in fields.pairs()]


def _files_of(files):
    if files is None:
        return None
    return [
        {
            "name": item.name(),
            "filename": item.filename(),
            "contentType": item.content_type(),
            "content": item.content().decode("latin-1"),
        }
        for _, items in files.pairs()
        for item in items
    ]


def _text(case, name: str) -> str:
    value = case.input(name)
    if not isinstance(value, str):
        raise LookupError(f"the case field {name} is not a string")
    return value
