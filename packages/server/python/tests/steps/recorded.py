# What the steps of contracts/client.json and contracts/app.json record of one request and how they compare it: the
# calls of the session store (HY-120), the reports of the response hook (HY-60) and the log of the server (HY-43.4).
import json

from polyspec.hyper.array_session import ArraySession


def decoded(text: object) -> object:
    """The value of a JSON text of a case, as a handler gives it (HY-44); NaN and Infinity are no JSON."""
    if not isinstance(text, str):
        raise LookupError("an argument of the case is not a JSON text")
    return json.loads(text, parse_constant=_reject)


def _reject(name: str) -> None:
    raise LookupError(f"the JSON text {name} is not a value of the case")


class RecordingStore:
    """The session store that the host passes to the application: the store in memory behind a recorder of the calls
    of the store, each written as its method and its key."""

    def __init__(self, store: ArraySession):
        self._store = store
        self.calls: list[str] = []

    def get(self, key: str) -> object:
        self.calls.append(f"get {key}")
        return self._store.get(key)

    def set(self, key: str, value: object) -> None:
        self.calls.append(f"set {key}")
        self._store.set(key, value)

    def remove(self, key: str) -> None:
        self.calls.append(f"remove {key}")
        self._store.remove(key)

    def renew(self) -> None:
        self.calls.append("renew")
        self._store.renew()


class Reports:
    """The response hook of a step: it records each report, and compares the reports of one request."""

    def __init__(self) -> None:
        self.calls: list[tuple] = []

    def __call__(self, request, response, elapsed, reply, failure) -> None:
        self.calls.append((request, response, elapsed, reply, failure))

    def last(self) -> tuple:
        """The last report: the request, the response, the elapsed time, the reply and the failure."""
        if not self.calls:
            raise LookupError("the response hook received no report")
        return self.calls[-1]

    def compare(self, case) -> None:
        """Compares `reported`, and `reportedHeaders` and `notes` of the last report when the case states one."""
        case.compare(
            "reported",
            [
                [
                    "null" if request is None else f"{request.method} {request.path()}",
                    response.status,
                ]
                for request, response, *_ in self.calls
            ],
        )
        if case.has("reportedHeaders") or case.has("notes"):
            _, response, _, reply, _ = self.last()
            case.compare("reportedHeaders", response.headers)
            case.compare("notes", [list(pair) for pair in reply.notes()])


def compare_log(case, logged: str) -> None:
    """Compares `logged` with the text that the server wrote to its log during the request, and `logCount` with the
    number of its lines that start a text of the server."""
    case.compare("logged", logged)
    case.compare(
        "logCount", sum(1 for line in logged.splitlines() if line.startswith("hyper: "))
    )
