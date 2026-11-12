# The steps of contracts/representations.json: the manifest and open rejections, and the rendered cases of the
# representations application, which run through the app with the handlers of the contract.
import contextlib
import io
import json
import tempfile
from pathlib import Path

from polyspec.hyper._session import _TOKEN_KEY
from polyspec.hyper.app import App
from polyspec.hyper.media_type import MediaType
from polyspec.hyper.reply import Reply
from polyspec.hyper.request import Request
from polyspec.hyper.representation import Representation
from polyspec.hyper.array_session import ArraySession

from ..case_reader import CaseReader
from ..render.render_functions import program_of
from .container_steps import SERVICES
from .recorded import decoded


class OrmError(Exception):
    """An error of the ORM, which hyper answers by its code (HY-107) because it checks the name of the class."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def manifest_rejections(case: CaseReader) -> None:
    """A manifest whose route declares the representations of the case fails the open."""
    application = case.input("applications")["representations"]
    route_name = case.input("route")
    representations = case.input("representations")
    manifest = json.loads(json.dumps(application["manifest"]))
    for route in manifest["routes"]:
        if route["name"] == route_name:
            route["representations"] = representations
    types = _declared_types(application)
    types[route_name] = [entry["type"] for entry in representations]
    _check_open(case, manifest, types)


def open_rejections(case: CaseReader) -> None:
    """A route whose entries have the handlers of the case fails the open when the handlers do not match them."""
    application = case.input("applications")["representations"]
    route_name = case.input("route")
    types = _declared_types(application)
    types[route_name] = case.input("handlers")
    _check_open(case, application["manifest"], types)


def cases(case: CaseReader) -> None:
    """Sends the request of the case through the representations application and compares the response, the calls
    of the handler, what the handler received and the session."""
    application = case.input("applications")["representations"]
    request_spec = case.input("request")
    handler_spec = case.input("handler") if case.has("handler") else None
    base_path = case.input("basePath") if case.has("basePath") else ""
    bound = case.input("bound") if case.has("bound") else []
    calls: list[dict] = []
    created: dict[str, object] = {}
    routes = {}
    for route in application["manifest"]["routes"]:
        name = route["name"]
        routes[name] = {
            "load": _loader(application["loaders"][name]),
            "representations": {
                entry["type"]: _handler(handler_spec, calls)
                for entry in route.get("representations", [])
            },
        }
    manifest, program = program_of("representations")
    app = App.open(
        manifest=str(manifest),
        program=str(program),
        handlers={"shared": None, "routes": routes},
        timezone="+09:00",
        base_path=base_path,
    )
    for name in bound:
        if name not in SERVICES:
            raise ValueError(f"the case binds the unknown service {name!r}")
        app.bind(SERVICES[name], _factory(name, created))
    store = ArraySession()
    target = request_spec["target"]
    request = Request(
        request_spec["method"],
        Request.target_path(target),
        dict(request_spec["headers"]),
        Request.target_query(target),
        request_spec.get("body", "").encode("utf-8"),
    )
    with contextlib.redirect_stderr(io.StringIO()):
        response = app.handle(request, store)
    observed = calls[-1] if calls else {}
    case.compare("status", response.status)
    case.compare("headers", response.headers)
    case.compare("body", response.body)
    case.compare("absentHeaders", response.headers)
    case.compare("page", _page_of(response.headers))
    case.compare("handled", len(calls))
    case.compare("session", store.get(_TOKEN_KEY) is not None)
    if not case.has("received"):
        return
    case.compare("received.method", observed.get("method"))
    case.compare("received.browser", observed.get("browser"))
    case.compare("received.parameters", observed.get("parameters"))
    case.compare("received.body", observed.get("body"))
    # The headers that the handler received are among the headers of the request of the case.
    received = {}
    if "request" in observed:
        for name in request_spec["headers"]:
            value = observed["request"].header(name)
            if value is not None:
                received[name] = value
    case.compare("received.headers", received)
    case.compare("received.absentHeaders", received)
    service = None if handler_spec is None else handler_spec.get("service")
    case.compare(
        "received.service",
        "service" in observed and observed["service"] is created.get(service),
    )
    case.compare("received.params", observed.get("params"))


def values(case: CaseReader) -> None:
    """Makes a representation with the status, with the value of the body when the case states it and with the
    headers when the case states them, and compares the three members."""
    status = case.input("status")
    if case.has("headers"):
        made = Representation(
            status, decoded(case.input("body")), case.input("headers")
        )
    elif case.has("body"):
        made = Representation(status, decoded(case.input("body")))
    else:
        made = Representation(status)
    case.compare(
        "held", {"status": made.status, "body": made.body, "headers": made.headers}
    )


def _declared_types(application: dict) -> dict:
    """Returns the representation types that each route of the manifest of the application declares."""
    return {
        route["name"]: [entry["type"] for entry in route.get("representations", [])]
        for route in application["manifest"]["routes"]
    }


def _check_open(case: CaseReader, manifest: dict, types: dict) -> None:
    """Opens the application with a manifest and handlers for the given types, and records whether the open raised a
    ValueError."""
    handlers = {
        "routes": {
            name: {
                "representations": {type_: _rejected_handler for type_ in entry_types}
            }
            for name, entry_types in types.items()
        }
    }
    program = program_of("representations")[1]
    with tempfile.TemporaryDirectory() as directory:
        written = Path(directory) / "manifest.json"
        written.write_text(json.dumps(manifest), encoding="utf-8")
        try:
            App.open(
                manifest=str(written),
                program=str(program),
                handlers=handlers,
                timezone="+09:00",
            )
        except Exception as error:  # noqa: BLE001 - the reader checks the class of the error
            raised = error
        else:
            raised = None
    case.outcome("open", raised)


def _rejected_handler(request: object, media: object) -> None:
    raise AssertionError("a representation handler of a rejection case is called")


def _loader(data: dict):
    def load(request: Request, reply: Reply) -> dict:
        return dict(data)

    return load


def _factory(name: str, created: dict):
    """Returns the factory of a service of the case, which remembers the one object that it creates."""

    def create() -> object:
        created[name] = SERVICES[name]()
        return created[name]

    return create


def _handler(spec: dict | None, calls: list):
    """Returns the representation handler of the case; with `service` it takes the service of that name between the
    media type and the request, each parameter named by its class (HY-105.4)."""

    def answer(request: Request, media: MediaType, received: dict) -> Representation:
        calls.append({**_observed(request, media), **received})
        if spec is None:
            raise AssertionError(
                "a case without a handler calls a representation handler"
            )
        if "throw" in spec:
            thrown = spec["throw"]
            if thrown["class"] != "OrmError":
                raise ValueError(f"the case throws an unknown class {thrown['class']}")
            raise OrmError(thrown["code"])
        return Representation(spec["status"], spec.get("body"), spec.get("headers"))

    if spec is None or "service" not in spec:

        def handle(request: Request, media: MediaType) -> Representation:
            return answer(request, media, {})

        return handle
    if spec["service"] not in SERVICES:
        raise ValueError(f"the handler takes the unknown service {spec['service']!r}")
    service_class = SERVICES[spec["service"]]

    def handle_with_service(
        media: MediaType, service: service_class, request: Request
    ) -> Representation:
        return answer(request, media, {"service": service})

    return handle_with_service


def _observed(request: Request, media: object) -> dict:
    """Returns what the handler receives: the method, the media parameters, the request and the value of its JSON
    body."""
    return {
        "method": request.method,
        "parameters": media.parameters(),
        "request": request,
        "browser": request.browser(),
        "params": request.params(),
        "body": request.json(),
    }


def _page_of(headers: dict) -> str | None:
    """Returns the media type of the Content-Type of a response, without its parameters."""
    content_type = headers.get("Content-Type")
    if content_type is None:
        return None
    return content_type.split(";", 1)[0].strip()
