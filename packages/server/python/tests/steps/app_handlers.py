# The handlers of an application of contracts/app.json: each handler of a case is a list of steps of a closed
# vocabulary, which this module performs in order for one call, with the services that the steps name.
import datetime
import inspect
import warnings
from collections.abc import Callable

from polyspec.hyper.server.bad_request import BadRequest
from polyspec.hyper.server.forbidden import Forbidden
from polyspec.hyper.server.not_found import NotFound
from polyspec.hyper.server.redirect import Redirect
from polyspec.hyper.server.reply import Reply
from polyspec.hyper.server.request import Request
from polyspec.hyper.server.result import Result

from .recorded import decoded
from . import reply_steps
from .representations_steps import OrmError

_STEPS = ("calls", "observe", "add", "warn")
_RESULTS = ("return", "stop", "throw", "redirect", "page")
_STOPS = {"NotFound": NotFound, "Forbidden": Forbidden, "BadRequest": BadRequest}


class Counter:
    """The service `counter`: a record whose members a case states."""


class Mailer:
    """The service `mailer`: a record whose members a case states."""


class ApplicationObject:
    """The value of the kind `applicationObject`: an object of the test tree with one public member."""

    def __init__(self) -> None:
        self.id = 1


class CountingMap(dict):
    """The value of the kind `countingMap`: a map that counts how many times its entries are enumerated."""

    def __init__(self, calls: "Calls") -> None:
        super().__init__({"a": 1})
        self._calls = calls

    def items(self):
        self._calls.reads += 1
        return super().items()


SERVICES = {"counter": Counter, "mailer": Mailer}
_KINDS: dict[str, Callable[[], object]] = {
    "date": lambda: datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc),
    "applicationObject": ApplicationObject,
    "notANumber": lambda: float("nan"),
    "largeFloat": lambda: 1e20,
    "floatTwoTo53": lambda: 9007199254740992.0,
    "loneSurrogate": lambda: "\ud800",
    "function": lambda: lambda: 1,
}


class Calls:
    """What the handlers of one application record: the names of the handlers whose calls started, and the pairs of a
    handler and the value that a step `observe` read, and the names of the kinds whose values they built."""

    def __init__(self) -> None:
        self.started: list[str] = []
        self.observed: list[list] = []
        self.kinds: set[str] = set()
        self.reads = 0

    def discard(self) -> None:
        self.started.clear()
        self.observed.clear()
        self.reads = 0


def handlers_of(spec: dict, calls: Calls) -> dict:
    """The handlers of `App.open` of a merged handler map of a case: only a stated handler is registered."""
    handlers: dict = {}
    if "shared" in spec:
        handlers["shared"] = _handler("shared", spec["shared"], calls)
    if "regions" in spec:
        handlers["regions"] = {
            name: _handler(f"region:{name}", steps, calls)
            for name, steps in spec["regions"].items()
        }
    if "routes" in spec:
        handlers["routes"] = {}
        for route, entry in spec["routes"].items():
            built: dict = {}
            if "load" in entry:
                built["load"] = _handler(f"load:{route}", entry["load"], calls)
            if "post" in entry:
                built["post"] = _handler(f"action:{route}", entry["post"], calls)
            if "regions" in entry:
                built["regions"] = {
                    name: _handler(f"region:{name}", steps, calls)
                    for name, steps in entry["regions"].items()
                }
            unknown = set(entry) - {"load", "post", "regions"}
            if unknown:
                raise LookupError(
                    f"the route {route} has the unknown handlers {sorted(unknown)}"
                )
            handlers["routes"][route] = built
    unknown = set(spec) - {"shared", "regions", "routes"}
    if unknown:
        raise LookupError(f"the handlers hold the unknown members {sorted(unknown)}")
    return handlers


def _handler(name: str, steps: object, calls: Calls) -> Callable:
    """Returns the function of a handler: it takes the request, the reply and each service that its steps name, by
    the class of each parameter (HY-105.4), records its name when its call starts and performs its steps."""
    if not isinstance(steps, list) or not steps:
        raise LookupError(f"the handler {name} is not a list of steps")
    for index, step in enumerate(steps):
        words = _RESULTS if index == len(steps) - 1 else _STEPS
        if not isinstance(step, dict) or not any(word in step for word in words):
            raise LookupError(
                f"the handler {name} does not end with one result after its steps"
            )
    services = _services(steps)

    def handle(request: Request, reply: Reply, *records: object) -> object:
        calls.started.append(name)
        run = _Run(
            name, request, reply, dict(zip(services, records, strict=True)), calls
        )
        for step in steps[:-1]:
            run.perform(step)
        return run.result(steps[-1])

    parameters = [
        inspect.Parameter(
            "request", inspect.Parameter.POSITIONAL_OR_KEYWORD, annotation=Request
        ),
        inspect.Parameter(
            "reply", inspect.Parameter.POSITIONAL_OR_KEYWORD, annotation=Reply
        ),
        *(
            inspect.Parameter(
                service,
                inspect.Parameter.POSITIONAL_OR_KEYWORD,
                annotation=SERVICES[service],
            )
            for service in services
        ),
    ]
    # The container reads the parameters and their classes; a handler names its services by them.
    handle.__signature__ = inspect.Signature(parameters)
    handle.__annotations__ = {
        parameter.name: parameter.annotation for parameter in parameters
    }
    return handle


def _services(steps: list) -> list[str]:
    """The names of the services that the steps of a handler name, in the order of their first use."""
    names: list[str] = []
    for step in steps:
        if "add" in step:
            names.append(step["add"][0])
        names.extend(_named(step))
    for name in names:
        if name not in SERVICES:
            raise LookupError(f"the service {name} of the case is unknown")
    return list(dict.fromkeys(names))


def _named(value: object) -> list[str]:
    """The names of the services of the expressions `service` of a value, in document order."""
    if isinstance(value, dict):
        if value.get("$") == "service":
            return [value["name"]]
        return [name for item in value.values() for name in _named(item)]
    if isinstance(value, list):
        return [name for item in value for name in _named(item)]
    return []


class _Run:
    """One call of a handler: its request, its reply and the records of its services."""

    def __init__(
        self, name: str, request: Request, reply: Reply, records: dict, calls: Calls
    ) -> None:
        self._name = name
        self._request = request
        self._reply = reply
        self._records = records
        self._calls = calls

    def perform(self, step: dict) -> None:
        if "calls" in step:
            for method, texts in step["calls"]:
                reply_steps.call(self._reply, method, [decoded(text) for text in texts])
        elif "observe" in step:
            self._calls.observed.append([self._name, self._value(step["observe"])])
        elif "add" in step:
            service, member, amount = step["add"]
            record = self._records[service]
            setattr(record, member, getattr(record, member) + amount)
        else:
            warnings.warn(step["warn"], RuntimeWarning, stacklevel=1)

    def result(self, step: dict) -> object:
        if "return" in step:
            return self._value(step["return"])
        if "stop" in step:
            if step["stop"] == "Redirect":
                raise Redirect(_redirect(step))
            if step["stop"] not in _STOPS:
                raise LookupError(f"the stop {step['stop']} of the case is unknown")
            raise _STOPS[step["stop"]]()
        if "throw" in step:
            thrown = step["throw"]
            if thrown["class"] == "OrmError":
                raise OrmError(thrown["code"])
            if thrown["class"] != "Error":
                raise LookupError(
                    f"the case throws the unknown class {thrown['class']}"
                )
            raise RuntimeError(thrown["message"])
        if "redirect" in step:
            return _redirect(step)
        return Result.page(step["page"], self._value(step.get("data", {})))

    def _value(self, value: object) -> object:
        """A data value of the case as the host value, with each expression evaluated in document order."""
        if isinstance(value, list):
            return [self._value(item) for item in value]
        if not isinstance(value, dict):
            return value
        if "$" not in value:
            return {key: self._value(item) for key, item in value.items()}
        request = self._request
        match value["$"]:
            case "param":
                return request.param(value["name"])
            case "queryInt":
                return request.query_int(value["name"], value["default"])
            case "formString":
                return request.form_string(value["name"])
            case "flash":
                return request.flash(value["name"])
            case "header":
                return request.header(value["name"])
            case "path":
                return request.path()
            case "method":
                return request.method
            case "selection":
                return request.selection()
            case "browser":
                return request.browser()
            case "csrfToken":
                return request.csrf_token()
            case "service":
                return getattr(self._records[value["name"]], value["member"])
            case "text":
                parts = [self._value(part) for part in value["parts"]]
                return "".join("" if part is None else str(part) for part in parts)
            case "kind":
                if value["name"] == "countingMap":
                    self._calls.kinds.add(value["name"])
                    return CountingMap(self._calls)
                if value["name"] not in _KINDS:
                    raise LookupError(
                        f"the kind {value['name']} has no value in Python"
                    )
                self._calls.kinds.add(value["name"])
                return _KINDS[value["name"]]()
        raise LookupError(f"the expression {value['$']} of the case is unknown")


def _redirect(step: dict) -> Result:
    """The redirect result of a step, with its flash values and its changed topics in their order."""
    result = Result.redirect(step["redirect"])
    for name, text in step.get("flashes", []):
        result = result.flash(name, decoded(text))
    for topic in step.get("topics", []):
        result = result.changed(topic)
    return result
