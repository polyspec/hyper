# The steps of the cases of contracts/client.json (HY-62): each case runs one request against the fixture application
# with the client rendering that the case states, then compares the response, the actions, the session, the calls of
# the representation handler and what that handler received.
import json
import tempfile
from pathlib import Path
from urllib.parse import urlencode

from polyspec.hyper._csrf import masked
from polyspec.hyper.client import Choice, ClientRendering
from polyspec.hyper.request import Request
from polyspec.hyper.session import ArraySession

from ..render.render_client import TOKEN, Counter, app


def cases(case) -> None:
    shell = case.input("shell")
    base_path = case.input("basePath")
    chosen_host = case.input("chosenHost")
    representations = case.input("representations")
    handler = case.input("handler")
    spec = case.input("request")

    headers = {name: str(value) for name, value in (spec.get("headers") or {}).items()}
    counter = Counter(headers)
    session = ArraySession()
    form = {name: str(value) for name, value in (spec.get("form") or {}).items()}
    if spec.get("csrf"):
        session.set("_hyper_csrf", TOKEN)
        form = {"_csrf": masked(TOKEN), **form}
    body = ""
    if form or "form" in spec:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        body = urlencode(form)
    if "body" in spec:
        body = spec["body"]
    target = spec["target"]
    question = target.find("?")
    query = "" if question < 0 else target[question + 1 :]
    path = target if question < 0 else target[:question]
    request = Request(spec["method"], path, headers, query, body.encode("utf-8"))
    if handler is not None:
        representations = _with_handler(representations, handler)

    with tempfile.TemporaryDirectory() as directory:
        shell_path = Path(directory) / "index.html"
        shell_path.write_text(shell, encoding="utf-8")
        client = ClientRendering(
            str(shell_path),
            base_path,
            lambda selected: Choice(selected.header("Host") == chosen_host, None),
        )
        response = app(counter, client, representations).handle(request, session)

    case.compare("status", response.status)
    case.compare("headers", response.headers)
    case.compare("absentHeaders", response.headers)
    case.compare("allHeaders", response.headers)
    if case.has("allHeaders") and response.body != shell:
        case.fail("the body of the shell response differs from the shell of the case")
    case.compare("body", response.body)
    if case.has("json"):
        answered = json.loads(response.body)
        case.compare("json.route", answered.get("route"))
        case.compare("json.params", answered.get("params"))
        case.compare("json.regions", list(answered.get("regions", {})))
    case.compare("session", session.get("_hyper_csrf") is not None)
    case.compare("actions", counter.actions)
    case.compare("handled", counter.handled)
    received = counter.received or {}
    case.compare("received.parameters", received.get("parameters"))
    case.compare("received.selection", received.get("selection"))
    case.compare("received.absentHeaders", received.get("headers", {}))


def _with_handler(representations: dict, handler: dict) -> dict:
    """Returns the representations of the case with each entry answering the `handler` response of the case."""
    return {
        name: [{**entry, "handler": handler} for entry in entries]
        for name, entries in representations.items()
    }
