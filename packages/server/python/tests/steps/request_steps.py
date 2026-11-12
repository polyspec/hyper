# The steps of contracts/request.json: the text that a host gives a request (HY-42.6) and the files of a request
# (HY-113.2).
from polyspec.hyper.request import Request


def texts(case) -> None:
    """Creates a request of the texts of the case and records the error of its creation, or None."""
    failure = None
    try:
        Request("GET", case.input("path"), dict(case.input("headers")), case.input("query"))
    except Exception as error:
        failure = error
    case.outcome("request", failure)


def files(case) -> None:
    """Reads the body of the case as a request and records the last file of each name and the pairs of the files."""
    kind = case.input("type").encode("latin-1").decode("latin-1")
    request = Request("POST", "/", {"Content-Type": kind}, "", case.input("body").encode("latin-1"))
    last = []
    for name in case.input("names"):
        found = request.file(name)
        last.append(None if found is None else found.filename())
    case.compare("last", last)
    case.compare("pairs", [[name, [item.filename() for item in items]] for name, items in request.files()])
