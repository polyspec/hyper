# The requests of the cases of contracts/file-sessions.json and contracts/redis-sessions.json: each step of a case opens
# the store of one request with its cookie, applies its calls and closes it, and the run records the results, the
# created identifiers and the first failure of each step.
import re
from collections.abc import Callable

from polyspec.hyper._json_codec import JsonCodec

from .recorded import decoded

_CREATED = re.compile(r"[0-9a-f]{64}\Z")
_METHODS = ("get", "set", "remove", "renew")


class StoreRequests:
    """The steps of one case on one store. `opener` opens the store of a request, `classes` names the classes of the
    failures that the case compares, and `others` holds the calls that are no method of the store, whose result is a
    result of the step unless it is None."""

    def __init__(
        self,
        opener: Callable,
        classes: Callable[[Exception], str | None],
        others: dict[str, Callable],
        known: list[str],
    ) -> None:
        self._opener = opener
        self._classes = classes
        self._others = others
        self._known = list(known)
        self.results: list[list] = []
        self.created: list[str | None] = []
        self.errors: list[list[str] | None] = []
        self.identifiers: list[str | None] = []
        self.message = ""

    def collected(self, number: int) -> None:
        """Records a step that is no request, with its one result."""
        self._record([number], None, None, None)

    def request(self, step: dict) -> None:
        """Runs one request: the open, the calls until the first failure, and the close after an open that returned."""
        cookie = self._cookie(step["cookie"])
        results: list = []
        failure: list | None = None
        try:
            store = self._opener(cookie)
        except Exception as error:  # noqa: BLE001 - the classes of the case decide what the failure is
            self._record(results, None, self._failed("open", error), None)
            return
        try:
            for method, texts in step["calls"]:
                arguments = [decoded(text) for text in texts]
                if method in self._others:
                    other = self._others[method](*arguments)
                    if other is not None:
                        results.append(other)
                elif method not in _METHODS:
                    raise LookupError(f"the method {method} of the case is unknown")
                elif method == "get":
                    results.append(JsonCodec.encode(store.get(*arguments)))
                elif method == "set":
                    store.set(*arguments)
                elif method == "remove":
                    store.remove(*arguments)
                else:
                    store.renew(*arguments)
        except Exception as error:  # noqa: BLE001 - the classes of the case decide what the failure is
            failure = self._failed("call", error, store)
        try:
            store.close()
        except Exception as error:  # noqa: BLE001 - the classes of the case decide what the failure is
            if failure is None:
                failure = self._failed("close", error)
        identifier = store.created()
        written = identifier
        if (
            isinstance(identifier, str)
            and _CREATED.match(identifier)
            and identifier != cookie
            and identifier not in self._known
        ):
            written = "new"
            self._known.append(identifier)
        self._record(results, written, failure, identifier)

    def _record(self, results, created, error, identifier) -> None:
        self.results.append(results)
        self.created.append(created)
        self.errors.append(error)
        self.identifiers.append(identifier)

    def _cookie(self, cookie: object) -> str | None:
        if cookie is None or isinstance(cookie, str):
            return cookie
        identifier = self.identifiers[cookie["created"]]
        if identifier is None:
            raise LookupError(f"step {cookie['created']} created no identifier")
        return identifier

    def _failed(self, where: str, error: Exception, store=None) -> list[str]:
        """The pair of a failure that the case compares; a failure of another class is an error of the step, after the
        close of an open store."""
        name = self._classes(error)
        if name is None:
            if store is not None:
                store.close()
            raise error
        if self.message == "":
            self.message = str(error)
        return [where, name]
