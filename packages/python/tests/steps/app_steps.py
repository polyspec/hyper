# The steps of contracts/app.json (the page application): each case of `cases` opens its application with the handlers
# and the options of the case, sends the requests of `before` and its own request in one session, and compares what the
# response, the handlers, the response hook, the session and the log show for that request. Each case of `opens` opens
# an application that the open refuses.
import contextlib
import hashlib
import io
import json
import re
import shutil
import tempfile
import time
import warnings
from pathlib import Path

from polyspec.hyper._csrf import Csrf
from polyspec.hyper._renderer import Renderer
from polyspec.hyper._session import Session
from polyspec.hyper.app import App
from polyspec.hyper.array_session import ArraySession
from polyspec.hyper.request import Request
from polyspec.hyper.response import Response

from ..render.render_functions import program_of
from .app_handlers import SERVICES, Calls, handlers_of
from .recorded import RecordingStore, Reports, compare_log, decoded

# The options of `App.open` that a case may state, by their names in the case file.
_OPTIONS = {
    "basePath": "base_path",
    "https": "https",
    "frameAncestors": "frame_ancestors",
    "bodyLimit": "body_limit",
    "fileLimit": "file_limit",
    "valueLimit": "value_limit",
    "partLimit": "part_limit",
    "responseLimit": "response_limit",
    "formTypes": "form_types",
}
_TOKEN_KEY = "_hyper_csrf"
_STORE_KEYS = (_TOKEN_KEY, "_hyper_flash", "_hyper_keep")
_TOKEN = re.compile(r"[0-9a-f]{64}\Z")
_MASKED = re.compile(r"(?<![0-9a-f])[0-9a-f]{128}(?![0-9a-f])")
_UNRESERVED = frozenset(
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
)
_DATA_START = '<script type="application/json" id="hy-data">'
# The files of an application that a case of `opens` replaces or removes, by their paths below the built directory.
_FILES = {
    "manifest": "manifest.json",
    "reads.json": "program/reads.json",
    "build.json": "program/build.json",
    "templates": "program/templates",
}


def cases(case) -> None:
    # A value of a kind is built in the runtime; the fixture names the kinds.
    kinds = case.input("valueKinds")
    run = _Session(case)
    earlier = {}
    for index, item in enumerate(case.input("before") if case.has("before") else []):
        name = item.get("name", str(index))
        answered = run.send(item)
        if "status" in item and answered.response.status != item["status"]:
            raise LookupError(
                f"the request {name} of before answered {answered.response.status}"
            )
        if name in earlier:
            raise LookupError(f"the name {name} of before is not unique")
        earlier[name] = answered
        run.earlier = earlier
    run.discard()
    answered = run.send(case.input("request"))
    unknown = run.calls.kinds - set(kinds)
    if unknown:
        raise LookupError(f"valueKinds does not hold the kinds {sorted(unknown)}")
    response = answered.response
    body = response.body
    token = answered.token

    case.compare("status", response.status)
    case.compare("headers", response.headers)
    case.compare("allHeaders", response.headers)
    case.compare("absentHeaders", response.headers)
    case.compare("body", body)
    case.compare("bodyContains", body)
    case.compare("bodyNotContains", body)
    unmasked = answered.unmasked()
    case.compare("unmaskedBody", unmasked)
    if case.has("members"):
        case.compare("members", _json_object(unmasked))
    if case.has("embedded"):
        start = unmasked.find(_DATA_START)
        end = unmasked.find("</script>", start)
        if start < 0 or end < 0:
            raise LookupError("the document holds no element hy-data")
        case.compare("embedded", _json_object(unmasked[start + len(_DATA_START) : end]))
    if case.has("bodyCount"):
        case.compare("bodyCount", [body.count(text) for text in case.input("counted")])
    if case.has("keys"):
        case.compare("keys", list(_json_object(body)))
    if case.has("sharedKeys"):
        case.compare("sharedKeys", list(_member(body, "shared")))
    if case.has("regionKeys"):
        case.compare("regionKeys", list(_member(body, "regions")))
    case.compare("tagOfBody", response.headers.get("ETag") == answered.tag())
    if case.has("sameAsEarlier"):
        name = case.input("earlier")
        if name not in earlier:
            raise LookupError(f"before holds no request {name}")
        other = earlier[name]
        tags = (response.headers.get("ETag"), other.response.headers.get("ETag"))
        masks = (answered.mask(), other.mask())
        case.compare(
            "sameAsEarlier",
            {
                "tag": tags[0] is not None and tags[0] == tags[1],
                "mask": masks[0] is not None and masks[0] == masks[1],
                "body": unmasked == other.unmasked(),
            },
        )
    started = run.calls.started
    case.compare("firstCalls", started)
    case.compare("handlerCalls", started)
    case.compare("actions", sum(1 for name in started if name.startswith("action:")))
    case.compare(
        "observed",
        [
            [name, _masked_word(_json_value(value), answered.token)]
            for name, value in run.calls.observed
        ],
    )
    if case.has("browsers"):
        case.compare(
            "browsers",
            [
                _browser_word(value, token, answered.token_before)
                for _name, value in run.calls.observed
            ],
        )
    case.compare("serviceValues", run.service_values())
    case.compare("valueReads", run.calls.reads)
    run.reports.compare(case)
    if any(
        case.has(name)
        for name in ("failure", "failureReported", "failureLogged", "elapsedFromStart")
    ):
        _, _, elapsed, _, failure = run.reports.last()
        case.compare("failure", "" if failure is None else failure)
        case.compare("failureReported", failure is not None)
        case.compare(
            "failureLogged",
            failure is not None and f"hyper: {failure}" in answered.logged.splitlines(),
        )
        case.compare(
            "elapsedFromStart",
            isinstance(elapsed, (int, float))
            and not isinstance(elapsed, bool)
            and answered.least <= elapsed <= answered.most,
        )
    case.compare(
        "storedAfter",
        {
            key: _json_value(run.session.get(key))
            for key in (*_STORE_KEYS, *run.session._values)
        },
    )
    case.compare("renewals", run.store.calls.count("renew"))
    mask = answered.mask()
    case.compare(
        "tokenOfSession",
        isinstance(token, str) and mask is not None and Csrf.verify(token, mask),
    )
    case.compare("tokenRenewed", token != answered.token_before)
    case.compare(
        "tokenForm", isinstance(token, str) and _TOKEN.match(token) is not None
    )
    case.compare("tokenInBody", isinstance(token, str) and token in body)
    case.compare("session", token is not None)
    case.compare("storeCalls", run.store.calls)
    compare_log(case, answered.logged)
    if case.has("restored"):
        case.compare("restored", _warning_outside())


def opens(case) -> None:
    """Opens the application of the case from a copy of its built directory with the files of the case, and compares
    the error of the open and its message."""
    application = _application(case)
    files = case.input("files") if case.has("files") else {}
    with tempfile.TemporaryDirectory(prefix="hyper-app-") as directory:
        root = Path(directory) / "application"
        shutil.copytree(program_of(application.name)[0].parent, root)
        for name, content in files.items():
            if name not in _FILES:
                raise LookupError(f"the file {name} of the case is unknown")
            file = root / _FILES[name]
            if content is None:
                shutil.rmtree(file) if file.is_dir() else file.unlink()
            elif file.is_dir():
                raise LookupError(f"the case replaces the directory {name}")
            else:
                file.write_bytes(_bytes(content))
        error = None
        try:
            application.open(
                root / "manifest.json", root / "program", Calls(), Reports()
            )
        except Exception as failure:  # noqa: BLE001 - the reader checks the class of the error
            error = failure
    case.outcome("open", error)
    case.compare("openError", "" if error is None else str(error))


def parts(case) -> None:
    """Renders the title and each region of the case alone and the document of its route, and compares the parts
    with their places in the document and in the page region."""
    name = case.input("application")
    application = case.input("applications")[name]
    manifest = application["manifest"]
    route = next(
        (item for item in manifest["routes"] if item["name"] == case.input("route")),
        None,
    )
    if route is None:
        raise LookupError(f"the application {name} has no route {case.input('route')}")
    renderer = Renderer.open(
        str(program_of(name)[1]), application.get("timezone", "+09:00")
    )
    shared = renderer.bind(case.input("shared"))
    bound = {
        region: renderer.bind(data) for region, data in case.input("regions").items()
    }
    route_regions = {
        region["name"]: {"template": region["template"], "data": bound[region["name"]]}
        for region in route.get("regions", [])
        if region["name"] in bound
    }
    page = next(region["name"] for region in manifest["regions"] if region.get("page"))
    title = renderer.alone(manifest["title"], shared, renderer.bind({}))
    texts = {}
    manifest_regions = {}
    for region in manifest["regions"]:
        template = route["template"] if region["name"] == page else region["template"]
        manifest_regions[region["name"]] = {
            "template": template,
            "data": bound[region["name"]],
        }
        texts[region["name"]] = renderer.alone(
            template,
            shared,
            bound[region["name"]],
            route_regions if region["name"] == page else None,
        )
    for region, entry in route_regions.items():
        texts[region] = renderer.alone(entry["template"], shared, entry["data"])
    frame = _placed(
        renderer.document(
            manifest["layout"],
            manifest["title"],
            shared,
            manifest_regions,
            page,
            route_regions,
            None,
            application["build"],
        ),
        "title",
        title,
    )
    for region in manifest["regions"]:
        frame = _placed(frame, region["name"], texts[region["name"]])
    page_frame = texts[page]
    for region in route_regions:
        page_frame = _placed(page_frame, region, texts[region])
    case.compare("title", title)
    case.compare("parts", {region: texts[region] for region in bound})
    case.compare("frame", frame)
    case.compare("pageFrame", page_frame)


def _placed(text: str, name: str, part: str) -> str:
    """The text with the first occurrence of a part replaced by the marker of its name."""
    if part == "" or part not in text:
        raise LookupError(
            f"the part {name} is empty or does not occur where it is placed"
        )
    return text.replace(part, "{# " + name + "}", 1)


class _Application:
    """The application of a case: the application of the fixture with the handlers and the options of the case
    merged over its own."""

    def __init__(self, name: str, spec: dict, handlers: dict, options: dict) -> None:
        self.name = name
        self._spec = spec
        self._handlers = handlers
        self._options = options
        self.services: dict[str, object] = {}

    def open(
        self, manifest: Path, program: Path, calls: Calls, reports: Reports
    ) -> App:
        """Opens the application with the handlers of its steps and the response hook of the step, and binds the
        factory of each of its services."""
        options = {}
        for name, value in self._options.items():
            if name not in _OPTIONS:
                raise LookupError(f"the option {name} of the case is unknown")
            options[_OPTIONS[name]] = value
        text = self._spec.get("context")
        if text is not None:
            context = decoded(text)

            def context_handler(selection: object) -> object:
                calls.started.append("context")
                return context

            options["context"] = context_handler
        app = App.open(
            manifest=str(manifest),
            program=str(program),
            handlers=handlers_of(self._handlers, calls),
            timezone=self._spec.get("timezone", "+09:00"),
            on_response=reports,
            **options,
        )
        for name, members in self._spec.get("services", {}).items():
            if name not in SERVICES:
                raise LookupError(f"the service {name} of the application is unknown")
            app.bind(SERVICES[name], self._factory(name, members))
        return app

    def _factory(self, name: str, members: dict):
        def create() -> object:
            record = SERVICES[name]()
            for member, value in members.items():
                setattr(record, member, value)
            self.services[name] = record
            return record

        return create

    def service_values(self) -> dict:
        """The members of each service of the application, or None for a service whose factory was not called."""
        return {
            name: dict(vars(self.services[name])) if name in self.services else None
            for name in self._spec.get("services", {})
        }


def _application(case) -> _Application:
    name = case.input("application")
    applications = case.input("applications")
    if name not in applications:
        raise LookupError(f"the contract has no application {name}")
    spec = applications[name]
    handlers = _merged_handlers(
        spec.get("handlers", {}), case.input("handlers") if case.has("handlers") else {}
    )
    options = {
        **spec.get("options", {}),
        **(case.input("options") if case.has("options") else {}),
    }
    return _Application(name, spec, handlers, options)


def _merged_handlers(base: dict, over: dict) -> dict:
    """The handlers of an application with those of a case over them, handler by handler; a handler that the case
    states as null is removed."""
    merged = json.loads(json.dumps(base))
    if "shared" in over:
        merged["shared"] = over["shared"]
    for name, steps in over.get("regions", {}).items():
        merged.setdefault("regions", {})[name] = steps
    for route, entry in over.get("routes", {}).items():
        if entry is None:
            merged.get("routes", {}).pop(route, None)
            continue
        target = merged.setdefault("routes", {}).setdefault(route, {})
        for key, value in entry.items():
            if key == "regions" and value is not None:
                target.setdefault("regions", {}).update(value)
            else:
                target[key] = value
    return _without_null(merged)


def _without_null(value: dict) -> dict:
    """A handler map without the handlers that are null."""
    return {
        key: _without_null(item) if isinstance(item, dict) else item
        for key, item in value.items()
        if item is not None
    }


class _Answered:
    """One answered request: its response, the token that the session held before and after it, the text that the
    server logged, and the least and the most milliseconds from the start of the request to its answer."""

    def __init__(
        self,
        response: Response,
        token_before: object,
        token: object,
        logged: str,
        least: float,
        most: float,
    ) -> None:
        self.response = response
        self.token_before = token_before
        self.token = token
        self.logged = logged
        self.least = least
        self.most = most

    def unmasked(self) -> str:
        """The body with each masked value of the token that the session held after the request replaced."""
        token = self.token
        if not isinstance(token, str):
            return self.response.body
        return _MASKED.sub(
            lambda found: (
                "masked" if Csrf.verify(token, found.group(0)) else found.group(0)
            ),
            self.response.body,
        )

    def mask(self) -> str | None:
        """The masked token of a JSON body, the string `shared.csrf`, or None."""
        try:
            document = json.loads(self.response.body)
        except ValueError:
            return None
        shared = document.get("shared") if isinstance(document, dict) else None
        mask = shared.get("csrf") if isinstance(shared, dict) else None
        return mask if isinstance(mask, str) else None

    def tag(self) -> str:
        """The tag of the body, in which the masked token is replaced by the token of the session (HY-53.1)."""
        body = self.response.body
        mask = self.mask()
        if mask is not None and isinstance(self.token, str):
            body = body.replace(mask, self.token)
        return 'W/"' + hashlib.sha256(body.encode("utf-8")).hexdigest()[:32] + '"'


class _Session:
    """The opened application of a case with its one session store, and what the requests of the case record."""

    def __init__(self, case) -> None:
        self._application = _application(case)
        self.calls = Calls()
        self.reports = Reports()
        self.session = ArraySession()
        self.store = RecordingStore(self.session)
        self.earlier: dict[str, _Answered] = {}
        manifest, program = program_of(self._application.name)
        self._app = self._application.open(manifest, program, self.calls, self.reports)
        for key, value in (case.input("stored") if case.has("stored") else {}).items():
            self.session.set(key, value)

    def discard(self) -> None:
        """Drops what the requests so far recorded; the services, the store and the application keep their state."""
        self.calls.discard()
        self.reports.calls.clear()

    def service_values(self) -> dict:
        return self._application.service_values()

    def send(self, spec: dict) -> _Answered:
        """Sends one request of the case and returns its answer."""
        unknown = set(spec) - {
            "name", "status", "method", "target", "headers", "cookies", "form", "csrf",
            "body", "https", "startedBefore",
        }  # fmt: skip
        if unknown:
            raise LookupError(
                f"the request holds the unknown members {sorted(unknown)}"
            )
        target = self._text(spec["target"])
        headers = {name: self._text(value) for name, value in spec["headers"].items()}
        cookies = {
            name: self._text(value) for name, value in spec.get("cookies", {}).items()
        }
        csrf = spec.get("csrf", False)
        if "form" in spec:
            if "body" in spec:
                raise LookupError("the request states a form and a body")
            fields = [(name, self._text(value)) for name, value in spec["form"].items()]
            if csrf is True:
                fields.append(("_csrf", Csrf.masked(self._token())))
            elif csrf == "token":
                fields.append(("_csrf", self._token()))
            elif csrf is not False:
                raise LookupError("the request field csrf is not true, false or token")
            body = "&".join(
                f"{_encoded(name)}={_encoded(value)}" for name, value in fields
            )
        elif csrf is not False:
            raise LookupError("the request states csrf without a form")
        else:
            body = self._text(spec.get("body", ""))
        request = Request(
            spec["method"],
            Request.target_path(target),
            headers,
            Request.target_query(target),
            _bytes(body),
            cookies=cookies,
            https=spec.get("https", False),
        )
        token_before = self.session.get(_TOKEN_KEY)
        self.store.calls.clear()
        log = io.StringIO()
        with contextlib.redirect_stderr(log):
            # The clock of `handle`, read just before the call and just after its return (HY-60.5).
            called = time.perf_counter_ns()
            if "startedBefore" in spec:
                start = called - spec["startedBefore"] * 1_000_000
                response = self._app.handle(request, self.store, start)
            else:
                start = called
                response = self._app.handle(request, self.store)
            returned = time.perf_counter_ns()
        return _Answered(
            response,
            token_before,
            self.session.get(_TOKEN_KEY),
            log.getvalue(),
            (called - start) / 1e6,
            (returned - start) / 1e6,
        )

    def _token(self) -> str:
        """The token of the session, which the session unit makes for a session without one (HY-24.1)."""
        return Session(self.session).csrf_token()

    def _text(self, value: object) -> str:
        """A text of a request: a string, a reference, or a list of both, joined."""
        if isinstance(value, str):
            return value
        if isinstance(value, list):
            return "".join(self._text(part) for part in value)
        if not isinstance(value, dict):
            raise LookupError(
                "a text of the request is no string, reference or list of parts"
            )
        if "token" in value:
            if value["token"] == "masked":
                return Csrf.masked(self._token())
            if value["token"] == "session":
                return self._token()
        elif "repeat" in value:
            return value["repeat"] * value["times"]
        elif "of" in value:
            if value["of"] not in self.earlier:
                raise LookupError(f"before holds no request {value['of']}")
            response = self.earlier[value["of"]].response
            if "header" in value:
                found = next(
                    (
                        item
                        for name, item in response.headers.items()
                        if name.lower() == value["header"].lower()
                    ),
                    None,
                )
            elif "json" in value:
                found = json.loads(response.body)
                for key in value["json"]:
                    found = found.get(key) if isinstance(found, dict) else None
            elif "setCookie" in value:
                lines = response.headers.get("Set-Cookie", [])
                prefix = value["setCookie"] + "="
                found = next(
                    (
                        line[len(prefix) :].split(";", 1)[0]
                        for line in lines
                        if line.startswith(prefix)
                    ),
                    None,
                )
            else:
                found = None
            if not isinstance(found, str):
                raise LookupError(
                    f"the response of {value['of']} holds no text for the reference"
                )
            return found
        raise LookupError(f"the reference {json.dumps(value)} of the case is unknown")


def _bytes(text: str) -> bytes:
    """The bytes of a text of a case, whose characters U+0000 to U+00FF are its bytes."""
    try:
        return text.encode("latin-1")
    except UnicodeEncodeError:
        raise LookupError("a text of the case holds a character above U+00FF") from None


def _encoded(text: str) -> str:
    """A form name or value with every byte outside the unreserved characters written as %XX."""
    return "".join(
        chr(byte) if byte in _UNRESERVED else f"%{byte:02X}" for byte in _bytes(text)
    )


def _json_object(text: str) -> dict:
    document = json.loads(text)
    if not isinstance(document, dict):
        raise LookupError("the text is no JSON object")
    return document


def _member(body: str, name: str) -> dict:
    member = _json_object(body).get(name)
    if not isinstance(member, dict):
        raise LookupError(f"the body of the response holds no map {name}")
    return member


def _json_value(value: object) -> object:
    """A value of the runtime as the JSON value that a case states."""
    return json.loads(json.dumps(value))


def _masked_word(value: object, token: object) -> object:
    """A value that a handler read, with a masked value of the token that the session holds after the request written
    as `masked`, as `members` and `embedded` write it (HY-24)."""
    if (
        isinstance(value, str)
        and isinstance(token, str)
        and _MASKED.fullmatch(value) is not None
        and Csrf.verify(token, value)
    ):
        return "masked"
    return value


def _browser_word(value: object, after: object, before: object) -> str:
    """Returns the word of a value that a handler read as `browser()`: `none` for None, `current` for the digest of
    the token that the session holds after the request, `previous` for the digest of another token that it held when
    the request was sent, and `other` for every other value."""

    def digest(token: object) -> str | None:
        if isinstance(token, str) and _TOKEN.match(token) is not None:
            return hashlib.sha256(bytes.fromhex(token)).hexdigest()
        return None

    if value is None:
        return "none"
    if digest(after) is not None and value == digest(after):
        return "current"
    if digest(before) is not None and before != after and value == digest(before):
        return "previous"
    return "other"


def _warning_outside() -> bool:
    """Raises a warning outside of every request and returns whether it was delivered and not raised as an error
    (HY-74.4)."""
    with warnings.catch_warnings(record=True) as delivered:
        try:
            warnings.warn("outside", RuntimeWarning, stacklevel=1)
        except RuntimeWarning:
            return False
    return len(delivered) == 1
