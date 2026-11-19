# The steps of contracts/representations.json: the manifest and open rejections, and the rendered cases of the
# representations application, which run through the app with the handlers of the contract.
import contextlib
import io
import json
import tempfile
from pathlib import Path
from typing import Callable

from polyspec.hyper.session._session import _TOKEN_KEY
from polyspec.hyper.app.app import App
from polyspec.hyper.representation.media_type import MediaType
from polyspec.hyper.http.reply import Reply
from polyspec.hyper.http.request import Request
from polyspec.hyper.representation.representation import Representation
from polyspec.hyper.session.array_session import ArraySession

from ..case_reader import CaseReader
from ..render.render_functions import program_of
from .container_steps import SERVICES
from .recorded import decoded


_PACKAGES = Path(__file__).resolve().parents[3]
_ORM_FIXTURE = _PACKAGES / "php" / "tests" / "fixtures" / "orm-errors.json"
_orm_caught: dict[str, Exception] | None = None


def orm_error(thrown: object, what: str) -> Exception:
    """Returns the error of the orm package that the `throw` of a case names by its class and its kind (HY-107.7),
    which a real orm call raised."""
    if (
        not isinstance(thrown, dict)
        or not isinstance(thrown.get("class"), str)
        or not isinstance(thrown.get("kind"), str)
    ):
        raise LookupError(f"the throw of {what} names no class and kind")
    key = f"{thrown['class']}:{thrown['kind']}"
    error = _orm_errors().get(key)
    if error is None:
        raise LookupError(f"{what} throws {key}, which _orm_errors does not get")
    return error


def _orm_errors() -> dict[str, Exception]:
    """Gets the errors of the orm package that the cases throw by real calls on a SQLite file of
    packages/php/tests/fixtures/orm-errors.json in a temporary directory, as the generated tests of orm 0.0.34 make them
    (test_generated.py): an update with an expected revision that the row does not hold gives `revision_changed` (line
    9203, test_b4_query_update_a_changed_revision), an update with require_match of a key that no row holds gives
    `no_rows` (line 9313), and a connection to a file in a missing directory gives the ORMStoreError `driver` (line
    3219). The database is closed and the directory removed before it returns (HR-87); the errors are kept."""
    global _orm_caught
    if _orm_caught is not None:
        return _orm_caught
    import polyspec.orm as orm

    fixture = json.loads(_ORM_FIXTURE.read_text(encoding="utf-8"))
    caught: dict[str, Exception] = {}
    with tempfile.TemporaryDirectory(prefix="hyper-orm-errors-") as directory:
        schema = orm.Schema.load(fixture["manifest"], "", fixture["manifestHash"])
        db = orm.Db.connect_schema(f"sqlite://{directory}/shop.db", schema, 1)
        try:
            for step in fixture["steps"]:
                db.execute(step, [])
            changed = orm.Query.new(schema, fixture["entity"])
            changed.connect(db)
            changed.set("id", orm.IntegerValue(fixture["revisionChanged"]["key"]))
            changed.set("qty", orm.IntegerValue(fixture["revisionChanged"]["qty"]))
            changed.expect_revision(
                fixture["revisionChanged"]["revisionColumn"],
                fixture["revisionChanged"]["revision"],
            )
            caught["OrmValueError:revision_changed"] = _raised(changed.update)
            missing = orm.Query.new(schema, fixture["entity"])
            missing.connect(db)
            missing.set("id", orm.IntegerValue(fixture["noRows"]["key"]))
            missing.set("qty", orm.IntegerValue(fixture["noRows"]["qty"]))
            missing.require_match()
            caught["OrmValueError:no_rows"] = _raised(missing.update)
        finally:
            db.close()
        caught["OrmStoreError:driver"] = _raised(
            lambda: orm.Db.connect(f"sqlite://{directory}/{fixture['driver']}", 1)
        )
    for key, error in caught.items():
        name, kind = key.split(":")
        if (
            type(error).__name__ != "ORM" + name[3:]
            or getattr(error, "kind", None) != kind
        ):
            raise LookupError(
                f"the orm call for {key} raised {type(error).__name__}: {error}"
            )
    _orm_caught = caught
    return caught


def _raised(call: Callable[[], object]) -> Exception:
    """The error that a call raises; a call that returns fails, since the case needs its error."""
    try:
        call()
    except Exception as error:  # noqa: BLE001 - the case needs the error that the orm call raises, whatever it is
        return error
    raise LookupError("an orm call that must fail returned")


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
    raises = (
        orm_error(spec["throw"], "the representation handler")
        if spec is not None and "throw" in spec
        else None
    )

    def answer(request: Request, media: MediaType, received: dict) -> Representation:
        calls.append({**_observed(request, media), **received})
        # HY-107.7, HY-122.12: a handler with `throw` raises the error of the orm package that it names.
        if raises is not None:
            raise raises
        if spec is None:
            raise AssertionError(
                "a case without a handler calls a representation handler"
            )
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
