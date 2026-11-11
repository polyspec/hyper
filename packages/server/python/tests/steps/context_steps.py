# The steps of contracts/context.json (HY-10, HY-124 to HY-128): each context entry compares its JSON text and its hashes,
# and each case opens its application, sends its request and compares the response, the context calls and the shared data.
import contextlib
import io
import json
from urllib.parse import urlencode

from polyspec.hyper._context import hash_of, signed_text, text_of
from polyspec.hyper._csrf import Csrf
from polyspec.hyper._json_codec import JsonCodec
from polyspec.hyper._session import Session
from polyspec.hyper.request import Request
from polyspec.hyper.session import ArraySession

from ..render.render_context import open_application, program_of

CONTEXT_ERROR = "hyper: ValueError: the shared handler returned the key context (HY-124)"


def contexts(case) -> None:
    build = case.input("build")
    text = case.input("context")
    value = JsonCodec.decode(text)
    case.compare("context", text_of(value))
    case.compare("text", signed_text(build, text_of(value)))
    case.compare("hash", hash_of(build, value))
    if case.has("reorderedText"):
        reordered = case.input("reorderedText")
        prefix = '{"build":"' + build + '","context":'
        observed = None
        if reordered.startswith(prefix):
            observed = hash_of(build, JsonCodec.decode(reordered[len(prefix) : -1]))
        case.compare("reorderedHash", observed)


def cases(case) -> None:
    applications = case.input("applications")
    name = case.input("application")
    application = applications[name]
    request = case.input("request")
    shared = case.input("shared") if case.has("shared") else application["shared"]
    manifest, program = program_of(name)
    calls: list[str] = []
    selections: list[object] = []
    app = open_application(application, shared, manifest, program, calls, selections)
    store = ArraySession()
    headers = dict(request.get("headers", {}))
    fields = dict(request.get("form", {}))
    if request.get("csrf") is True:
        # HY-24: the first response of the session creates its token; the form carries a masked value of it.
        app.handle(Request("GET", "/", {"Accept": "text/html"}), store)
        calls.clear()
        selections.clear()
        fields["_csrf"] = Csrf.masked(Session(store).csrf_token())
    body = urlencode(fields).encode("utf-8") if fields else b""
    target = request["target"]
    sent = Request(
        request["method"],
        Request.target_path(target),
        headers,
        Request.target_query(target),
        body,
    )
    # The server writes the cause of a 500 to stderr (HY-43); the case captures it, so that the report of the runner
    # holds only its own result.
    logged = io.StringIO()
    with contextlib.redirect_stderr(logged):
        response = app.handle(sent, store)
    case.compare("status", response.status)
    if response.status == 500 and CONTEXT_ERROR not in logged.getvalue():
        case.fail("the log of the 500 lacks the context error (HY-43, HY-124)")
    case.compare("headers", response.headers)
    case.compare("absentHeaders", response.headers)
    case.compare("body", response.body)
    case.compare("bodyContains", response.body)
    case.compare("bodyNotContains", response.body)
    if case.has("keys") or case.has("sharedKeys"):
        document = json.loads(response.body)
        case.compare("keys", list(document))
        if case.has("sharedKeys"):
            case.compare("sharedKeys", list(document["shared"]))
    case.compare("contextCalls", calls.count("context"))
    case.compare("firstCalls", calls)
    case.compare("selection", selections)
