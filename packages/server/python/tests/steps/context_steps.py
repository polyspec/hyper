# The steps of contracts/context.json (HY-10, HY-124 to HY-128): each context entry compares its JSON text and its hashes,
# and each case opens its application, sends its request and compares the response, the context calls and the shared data.
import contextlib
import io
import json
from urllib.parse import urlencode

from polyspec.hyper._context import Context
from polyspec.hyper._csrf import Csrf
from polyspec.hyper._json_codec import JsonCodec
from polyspec.hyper._session import Session
from polyspec.hyper.request import Request
from polyspec.hyper.array_session import ArraySession

from ..render.render_context import open_application, program_of


def contexts(case) -> None:
    build = _string_field(case, "build")
    text = Context.text(
        _map_of(JsonCodec.decode(_string_field(case, "context")), "context")
    )
    case.compare("context", text)
    case.compare("text", '{"build":"' + build + '","context":' + text + "}")
    case.compare("hash", Context.hash(build, text))
    if case.has("reorderedText"):
        reordered = _map_of(
            JsonCodec.decode(_string_field(case, "reorderedText")), "reorderedText"
        )
        if "context" not in reordered:
            raise ValueError("reorderedText has no member context")
        context = _map_of(reordered["context"], "the member context of reorderedText")
        case.compare("reorderedHash", Context.hash(build, Context.text(context)))


def with_context(case) -> None:
    shared = {name: name for name in _string_list(case, "shared")}
    keys = None
    context = None
    fails = False
    try:
        placed = Context.with_context(shared, {"name": "Board"})
        keys = list(placed)
        context = placed["context"]
    except ValueError as error:
        if "already holds the member context" not in str(error):
            raise
        fails = True
    case.compare("keys", keys)
    case.compare("context", context)
    case.compare("fails", fails)


def _string_list(case, name: str) -> list[str]:
    """Returns a field of a case that is a list of strings, and fails for any other value."""
    value = case.input(name)
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise TypeError(f"the case field {name} is not a list of strings")
    return value


def _string_field(case, name: str) -> str:
    """Returns a string field of a case, and fails for any other value."""
    value = case.input(name)
    if not isinstance(value, str):
        raise TypeError(f"the case field {name} is not a string")
    return value


def _map_of(value: object, name: str) -> dict:
    """Returns a decoded value that is a map of the data model, and fails for any other value."""
    if not isinstance(value, dict) or not JsonCodec.in_data_model(value):
        raise TypeError(f"{name} is not a map of the data model")
    return value


def cases(case) -> None:
    """Opens the application of a case with its shared data and its context, sends its request and compares the
    response, the failure that the response hook received (HY-60), the context calls and the shared data."""
    name = _string_field(case, "application")
    applications = case.input("applications")
    if not isinstance(applications, dict) or not isinstance(
        applications.get(name), dict
    ):
        raise ValueError(f"the contract has no application {name}")
    application = applications[name]
    # Absent shared data declares no shared handler; present shared data must be a map.
    shared = case.input("shared") if case.has("shared") else application.get("shared")
    if shared is not None and not isinstance(shared, dict):
        raise TypeError("the shared data of the case is not a map")
    context = (
        _string_field(case, "context")
        if case.has("context")
        else application.get("context")
    )
    request = case.input("request")
    if not isinstance(request, dict):
        raise TypeError("the case field request is not a map")
    manifest, program = program_of(name)
    calls: list[str] = []
    selections: list[object] = []
    failures: list[str | None] = []
    app = open_application(
        application, shared, manifest, program, calls, selections, context, failures
    )
    store = ArraySession()
    headers = _texts(request, "headers")
    fields = _texts(request, "form") if "form" in request else {}
    csrf = request.get("csrf", False)
    if not isinstance(csrf, bool):
        raise TypeError("the request field csrf is not a boolean")
    if csrf:
        # HY-24: the first response of the session creates its token; the form carries a masked value of it.
        app.handle(Request("GET", "/", {"Accept": "text/html"}), store)
        calls.clear()
        selections.clear()
        fields["_csrf"] = Csrf.masked(Session(store).csrf_token())
    body = urlencode(fields).encode("utf-8") if fields else b""
    target = _text(request, "target")
    sent = Request(
        _text(request, "method"),
        Request.target_path(target),
        headers,
        Request.target_query(target),
        body,
    )
    # The server writes the cause of a 500 to stderr (HY-43); the case captures it, so that the report of the runner
    # holds only its own result. The failure is compared as the response hook received it (HY-60).
    with contextlib.redirect_stderr(io.StringIO()):
        response = app.handle(sent, store)
    case.compare("status", response.status)
    case.compare("headers", response.headers)
    case.compare("absentHeaders", response.headers)
    case.compare("body", response.body)
    case.compare("bodyContains", response.body)
    case.compare("bodyNotContains", response.body)
    case.compare("failure", failures[-1] if failures else None)
    if case.has("keys") or case.has("sharedKeys"):
        document = json.loads(response.body)
        if not isinstance(document, dict) or not isinstance(
            document.get("shared"), dict
        ):
            raise TypeError(
                "the body of the response is not a JSON object with shared data"
            )
        case.compare("keys", list(document))
        case.compare("sharedKeys", list(document["shared"]))
    case.compare("contextCalls", calls.count("context"))
    case.compare("firstCalls", calls)
    case.compare("selection", selections)


def _text(request: dict, field: str) -> str:
    """Returns a string field of a request, and fails for any other value."""
    value = request.get(field)
    if not isinstance(value, str):
        raise TypeError(f"the request field {field} is not a string")
    return value


def _texts(request: dict, field: str) -> dict[str, str]:
    """Returns a field of a request that maps names to strings, and fails for any other value."""
    value = request.get(field)
    if not isinstance(value, dict) or not all(
        isinstance(item, str) for item in value.values()
    ):
        raise TypeError(f"the request field {field} is not a map of strings")
    return dict(value)
