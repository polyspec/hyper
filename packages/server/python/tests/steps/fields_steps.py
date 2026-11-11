# The steps of contracts/fields.json (HY-56, HY-57, HY-113): a urlencoded text is the UTF-8 encoding of its JSON
# string, and a multipart type and body are text whose characters are their bytes.
from polyspec.hyper._fields import Fields
from polyspec.hyper._files import Files


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
    fields = Fields.from_body(kind, body)
    case.compare(
        "fields", None if fields is None else [list(pair) for pair in fields.pairs()]
    )
    files = Files.from_body(kind, body)
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
            }
            for _, items in files.pairs()
            for item in items
        ],
    )


def _text(case, name: str) -> str:
    value = case.input(name)
    if not isinstance(value, str):
        raise LookupError(f"the case field {name} is not a string")
    return value
