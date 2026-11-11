# The steps of contracts/fields.json (HY-56, HY-57, HY-113): a urlencoded text is the UTF-8 encoding of its JSON
# string, and a multipart type and body are text whose characters are their bytes.
from polyspec.hyper._fields import Fields
from polyspec.hyper._files import Files
from polyspec.hyper._multipart import Multipart


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
            parts = Multipart(boundary)
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
