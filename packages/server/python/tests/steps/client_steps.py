# The steps of contracts/client.json (HY-62). Each case of `cases` runs one request against the fixture application
# with the client rendering that the case states, then compares the response, the actions, the session, the calls of
# the session store, of the selection, of the handlers, of the response hook and of the representation handler, and
# the log. Each case of `openRejections` opens the fixture application with a client rendering that the open refuses.
import contextlib
import io
import os
import json
import tempfile
from collections.abc import Callable
from pathlib import Path
from urllib.parse import urlencode

from polyspec.hyper.server._csrf import Csrf
from polyspec.hyper.server.app import App
from polyspec.hyper.server.array_session import ArraySession
from polyspec.hyper.server.choice import Choice
from polyspec.hyper.server.client_rendering import ClientRendering
from polyspec.hyper.server.media_type import MediaType
from polyspec.hyper.server.representation import Representation
from polyspec.hyper.server.request import Request
from polyspec.hyper.server.result import Result

from ..render.fixture_app import FIXTURES, PROGRAM
from .inputs import options_of
from .recorded import RecordingStore, Reports, compare_log

# A session token of HY-24; the form carries a masked value of it.
_TOKEN = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
# The options of `App.open` that a case may state, by their names in the case file.
_OPTIONS = {"bodyLimit": "body_limit", "frameAncestors": "frame_ancestors"}
_RELATIVE_SHELL = "tests/fixtures/shell/index.html"


class Counter:
    """The service `counter` of the fixture application, and the calls that the step records: of the representation
    handlers with what the last one received, and of the handlers with the selection value that each read."""

    def __init__(self, header_names: tuple = ()) -> None:
        self.count = 0
        self.actions = 0
        self.handled = 0
        self.received: dict | None = None
        self.observed: list[list] = []
        # The names of the request headers that a representation handler looks up in what it received.
        self.header_names = header_names


def cases(case) -> None:
    shell = case.input("shell")
    base_path = case.input("basePath")
    chosen_host = case.input("chosenHost")
    representations = case.input("representations")
    handler = case.input("handler")
    spec = case.input("request")
    selects = case.input("selects") if case.has("selects") else "host"
    options = options_of(case, _OPTIONS)

    headers = {name: str(value) for name, value in (spec.get("headers") or {}).items()}
    counter = Counter(tuple(headers))
    session = ArraySession()
    form = {name: str(value) for name, value in (spec.get("form") or {}).items()}
    if spec.get("csrf"):
        session.set("_hyper_csrf", _TOKEN)
        form = {"_csrf": Csrf.masked(_TOKEN), **form}
    body = ""
    if form or "form" in spec:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        body = urlencode(form)
    if "body" in spec:
        body = spec["body"]
    target = spec["target"]
    request = Request(
        spec["method"],
        Request.target_path(target),
        headers,
        Request.target_query(target),
        body.encode("utf-8"),
    )
    if handler is not None:
        representations = {
            name: [{**entry, "handler": handler} for entry in entries]
            for name, entries in representations.items()
        }
    selections: list[Request] = []
    reports = Reports()

    with tempfile.TemporaryDirectory(prefix="hyper-client-") as directory:
        shell_path = Path(directory) / "index.html"
        shell_path.write_text(shell, encoding="utf-8")
        client = ClientRendering(
            str(shell_path), base_path, _selection(selects, chosen_host, selections)
        )
        application = _app(
            directory,
            counter,
            client,
            representations,
            case.has("observed"),
            on_response=reports,
            **options,
        )
        store = RecordingStore(session)
        log = io.StringIO()
        with contextlib.redirect_stderr(log):
            response = application.handle(request, store)

    case.compare("status", response.status)
    case.compare("headers", response.headers)
    case.compare("absentHeaders", response.headers)
    case.compare("allHeaders", response.headers)
    if case.has("allHeaders") and response.body != shell:
        case.fail("the body of the shell response differs from the shell of the case")
    case.compare("body", response.body)
    case.compare("bodyContains", response.body)
    case.compare("bodyNotContains", response.body)
    if case.has("json"):
        answered = json.loads(response.body)
        case.compare("json.route", answered.get("route"))
        case.compare("json.params", answered.get("params"))
        case.compare("json.regions", list(answered.get("regions", {})))
    case.compare("session", session.get("_hyper_csrf") is not None)
    case.compare("actions", counter.actions)
    case.compare("handled", counter.handled)
    case.compare("storeCalls", store.calls)
    case.compare("firstStoreCalls", store.calls)
    case.compare("selections", len(selections))
    case.compare("observed", counter.observed)
    reports.compare(case)
    compare_log(case, log.getvalue())
    if not case.has("received"):
        return
    received = counter.received or {}
    case.compare("received.parameters", received.get("parameters"))
    case.compare("received.selection", received.get("selection"))
    case.compare("received.absentHeaders", received.get("headers", {}))


def open_rejections(case) -> None:
    """Opens the fixture application with the shell and the data base path of the case, and compares the error of the
    open and its message."""
    shell = case.input("shell")
    base_path = case.input("basePath")
    shell_file = case.input("shellFile")
    data_base_path = (
        case.input("dataBasePath") if case.has("dataBasePath") else base_path
    )
    declared = f'<meta name="hyper-api" content="{base_path}">'
    if shell.count(declared) != 1:
        raise LookupError(
            "the shell of the case file does not declare its base path once"
        )
    with tempfile.TemporaryDirectory(prefix="hyper-client-") as directory:
        file = Path(directory) / "index.html"
        if shell_file == "declared":
            content = f'<meta name="hyper-api" content="{data_base_path}">'
            file.write_bytes(shell.replace(declared, content).encode("utf-8"))
        elif shell_file == "other-base":
            content = '<meta name="hyper-api" content="/api">'
            file.write_bytes(shell.replace(declared, content).encode("utf-8"))
        elif shell_file == "relative":
            file = Path(_RELATIVE_SHELL)
        elif shell_file == "missing":
            file = Path(directory) / "missing.html"
        elif shell_file == "directory":
            file = Path(directory)
        elif shell_file == "unreadable":
            file.write_bytes(shell.encode("utf-8"))
            file.chmod(0)
            if os.access(file, os.R_OK):
                file.chmod(0o600)
                raise LookupError(
                    "the user of the run reads a file of mode 0, so the case checks nothing"
                )
        elif shell_file == "not-utf8":
            file.write_bytes(shell.encode("utf-8") + b"\xff\xfe")
        else:
            raise LookupError(f"the shell file {shell_file} of the case is unknown")
        client = ClientRendering(
            str(file), data_base_path, lambda request: Choice(True, None)
        )
        error = None
        try:
            _app(directory, Counter(), client, {}, False)
        except Exception as failure:  # noqa: BLE001 - the reader checks the class of the error
            error = failure
        if shell_file == "unreadable":
            file.chmod(0o600)
    case.outcome("open", error)
    case.compare("openError", "" if error is None else str(error))


def declaration(case) -> None:
    """Makes a choice and a client rendering with their constructors and compares what they hold; the selection of the
    rendering is called with a request GET / and returns that choice. No application opens, so no shell is read."""
    choice = Choice(case.input("chosen"), case.input("value"))
    rendering = ClientRendering(
        case.input("shellPath"), case.input("dataBasePath"), lambda request: choice
    )
    case.compare("choice", {"chosen": choice.chosen, "value": choice.value})
    selected = rendering.selects(Request("GET", "/"))
    case.compare(
        "rendering",
        {
            "shell": rendering.shell,
            "basePath": rendering.base_path,
            "selected": {"chosen": selected.chosen, "value": selected.value},
        },
    )


def _selection(name: str, chosen_host: str, calls: list) -> Callable[[Request], object]:
    """Returns the selection of the client rendering that the case names, which records each of its calls."""

    def host(request: Request) -> object:
        return Choice(request.header("Host") == chosen_host, None)

    def host_value(request: Request) -> object:
        return Choice(
            request.header("Host") == chosen_host,
            {"host": request.header("Host") or ""},
        )

    def throws(request: Request) -> object:
        raise RuntimeError("selection")

    selections: dict[str, Callable[[Request], object]] = {
        "host": host,
        "hostValue": host_value,
        "text": lambda request: "csr",
        "boolean": lambda request: True,
        "throws": throws,
        "chosenNotBoolean": lambda request: Choice("yes", None),
        "record": lambda request: {"chosen": True, "value": None},
    }
    if name not in selections:
        raise LookupError(f"the selection {name} of the case is unknown")

    def selects(request: Request) -> object:
        calls.append(request)
        return selections[name](request)

    return selects


def _app(
    directory: str,
    counter: Counter,
    client: ClientRendering | None,
    representations: dict,
    observed: bool,
    **options,
) -> App:
    """Opens the fixture application, the manifest of the PHP fixtures with the representations of the case, with the
    client rendering `client` and the service `counter`. Each entry of `representations` holds the response `handler`
    of its representation handler. `observed` adds a shared handler and records the selection value that each handler
    reads."""
    manifest = json.loads((FIXTURES / "app.json").read_text(encoding="utf-8"))
    for route in manifest["routes"]:
        if route["name"] in representations:
            route["representations"] = [
                {key: value for key, value in entry.items() if key != "handler"}
                for entry in representations[route["name"]]
            ]
    path = Path(directory) / "app.json"
    path.write_text(json.dumps(manifest), encoding="utf-8")
    application = App.open(
        manifest=str(path),
        program=str(PROGRAM),
        handlers=_handlers(representations, observed),
        timezone="+09:00",
        client_rendering=client,
        **options,
    )
    application.bind(Counter, lambda: counter)
    return application


def _handlers(representations: dict, observed: bool) -> dict:
    """Returns the client fixture handlers: the one handler set of the cases of contracts/client.json."""

    def side(request: Request, counter: Counter) -> dict:
        return {"count": counter.count, "note": None}

    def home(request: Request, counter: Counter) -> dict:
        return {"name": f"n{counter.count}"}

    def add(request: Request, counter: Counter) -> Result:
        counter.actions += 1
        if request.form_string("name") == "taken":
            return Result.page(409, {"name": "taken", "error": "conflict"})
        counter.count += 1
        return Result.redirect("/")

    def rows(request: Request, counter: Counter) -> dict:
        return {
            "items": [],
            "open": False,
            "mode": "a",
            "view": "x",
            "filter": {"a": 1},
            "tags": [],
        }

    def item(request: Request, counter: Counter) -> dict:
        return {"id": request.param("id")}

    def shared(request: Request, counter: Counter) -> dict:
        return {}

    def seen(name: str, handler: Callable) -> Callable:
        if not observed:
            return handler

        def recorded(request: Request, counter: Counter) -> object:
            counter.observed.append([name, request.selection()])
            return handler(request, counter)

        return recorded

    routes: dict = {
        "home": {"load": seen("load:home", home)},
        "add": {"post": seen("action:add", add)},
        "list": {"regions": {"rows": seen("region:rows", rows)}},
        "item": {"load": seen("load:item", item)},
    }
    for name, entries in representations.items():
        routes[name]["representations"] = {
            entry["type"]: _representation(entry["handler"]) for entry in entries
        }
    handlers = {"regions": {"side": seen("region:side", side)}, "routes": routes}
    if observed:
        handlers["shared"] = seen("shared", shared)
    return handlers


def _representation(response: dict) -> Callable:
    """Returns a representation handler that answers `response` and records its call and what it received (HY-122)."""

    def handler(request: Request, media: MediaType, counter: Counter) -> Representation:
        counter.handled += 1
        counter.received = {
            "parameters": media.parameters(),
            "selection": request.selection(),
            "headers": {
                name: request.header(name)
                for name in counter.header_names
                if request.header(name) is not None
            },
        }
        return Representation(
            response["status"], response.get("body"), response.get("headers")
        )

    return handler
