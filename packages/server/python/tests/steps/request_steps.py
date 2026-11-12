# The steps of contracts/request.json: the text that a host gives a request (HY-42.6), the files of a request
# (HY-113.2), the path and the query of a request target (HY-42, HY-56) and the values that a request gives.
from polyspec.hyper._cookies import Cookies
from polyspec.hyper.request import Request

_NO_MEDIA = "the request holds no selected media type"


def texts(case) -> None:
    """Creates a request of the texts of the case and records the error of its creation, or None."""
    failure = None
    try:
        Request(
            "GET", case.input("path"), dict(case.input("headers")), case.input("query")
        )
    except Exception as error:  # noqa: BLE001 - the reader checks the class of the error
        failure = error
    case.outcome("request", failure)


def files(case) -> None:
    """Reads the body of the case as a request and records the last file of each name and the pairs of the files."""
    kind = case.input("type").encode("latin-1").decode("latin-1")
    request = Request(
        "POST", "/", {"Content-Type": kind}, "", case.input("body").encode("latin-1")
    )
    last = []
    for name in case.input("names"):
        found = request.file(name)
        last.append(None if found is None else found.filename())
    case.compare("last", last)
    case.compare(
        "pairs",
        [
            [name, [item.filename() for item in items]]
            for name, items in request.files()
        ],
    )


def targets(case) -> None:
    """Compares the path and the raw query of the request target of the case."""
    target = case.input("target")
    case.compare("path", Request.target_path(target))
    case.compare("query", Request.target_query(target))


def values(case) -> None:
    """Builds the request of the case as a host does, copies it with the headers of `with`, and compares the members
    that the case states."""
    spec = case.input("request")
    target = spec["target"]
    headers = dict(spec.get("headers", {}))
    if "cookies" in spec:
        cookies = dict(spec["cookies"])
    else:
        header = next(
            (value for name, value in headers.items() if name.lower() == "cookie"), None
        )
        cookies = Cookies.parse(None if header is None else header.encode("latin-1"))
    original = Request(
        spec.get("method", "GET"),
        Request.target_path(target),
        headers,
        Request.target_query(target),
        spec.get("body", "").encode("latin-1"),
        cookies=cookies,
        https=spec.get("https", False),
    )
    if "selection" in spec:
        original = original._with_selection(spec["selection"])
    if "media" in spec:
        original = original._with_media(spec["media"])
    request = original
    for name, value in case.input("with") if case.has("with") else []:
        request = request.with_header(name, value)

    case.compare("method", request.method)
    case.compare("path", request.path())
    case.compare("rawQuery", request.raw_query())
    case.compare("query", _pairs(request.query()))
    if case.has("queryInt"):
        case.compare(
            "queryInt",
            [
                request.query_int(name, default)
                for name, default in case.input("integers")
            ],
        )
    case.compare("form", _pairs(request.form()))
    if case.has("formString"):
        case.compare(
            "formString",
            [request.form_string(name) for name in case.input("formNames")],
        )
    if case.has("cookie"):
        case.compare(
            "cookie", [request.cookie(name) for name in case.input("cookieNames")]
        )
    if case.has("header") or case.has("original.header"):
        names = case.input("headerNames")
        case.compare("header", [request.header(name) for name in names])
        case.compare("original.header", [original.header(name) for name in names])
    case.compare("https", request.https)
    case.compare("selection", request.selection())
    case.compare("valid", request.valid_input())
    case.compare("bodySize", request.body_size())
    case.compare("currentPath", request.current_path())
    if case.has("wantsJson"):
        case.compare("wantsJson", _kind(request.wants_json))
    if case.has("isRegionRequest"):
        case.compare("isRegionRequest", _kind(request.is_region_request))


def _pairs(pairs: list) -> list:
    """The pairs of a name and its values as lists, as the case writes them."""
    return [[name, list(items)] for name, items in pairs]


def _kind(member) -> object:
    """The result of a member that needs the selected type, or `caller error` for the error of a request without one
    (HY-116.16)."""
    try:
        return member()
    except RuntimeError as error:
        if type(error) is not RuntimeError or _NO_MEDIA not in str(error):
            raise
        return "caller error"
