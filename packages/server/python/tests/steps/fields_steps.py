# The steps of contracts/fields.json (HY-56, HY-57, HY-113, HY-114): urlencoded text and multipart bodies.
from polyspec.hyper._fields import Fields, Files

from ..field_entries import entries


def file_entries(files):
    """The name, file name, content type and content of each file of a body in order, or None when it is invalid."""
    if files is None:
        return None
    return [
        {
            "name": name,
            "filename": item.filename,
            "contentType": item.content_type,
            "content": item.content.decode("latin-1"),
        }
        for name in files.names()
        for item in files.get(name)
    ]


def urlencoded(case) -> None:
    fields = Fields.parse(case.input("text").encode("utf-8"))
    case.compare("fields", entries(fields))
    case.compare("names", None if fields is None else list(fields.names()))


def multipart(case) -> None:
    kind = case.input("type")
    body = case.input("body").encode("latin-1")
    case.compare("fields", entries(Fields.from_body(kind, body)))
    case.compare("files", file_entries(Files.from_body(kind, body)))
