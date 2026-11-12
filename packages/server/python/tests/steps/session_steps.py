# The steps of contracts/session.json (HY-24, HY-25, HY-40, HY-72, HY-104): the token, the flash values and the kept
# values of one session over a new store in memory.
import re

from polyspec.hyper._flash import Flash
from polyspec.hyper._session import Session
from polyspec.hyper.array_session import ArraySession
from polyspec.hyper.session_store import SessionStore

from .data_model_errors import data_model_message
from .inputs import calls_of
from .recorded import decoded

_HEXADECIMAL = re.compile(r"[0-9a-f]{64}\Z")


def token(case) -> None:
    """Records the number of each token among the distinct tokens, their form and the renewals of the store."""
    store = ArraySession()
    session = Session(store)
    distinct: list[str] = []
    numbers = []
    for method, texts in calls_of(case):
        result = _call(session, method, texts)
        if method == "csrfToken":
            if result not in distinct:
                distinct.append(result)
            numbers.append(distinct.index(result) + 1)
    case.compare("tokens", numbers)
    case.compare(
        "hexadecimal",
        all(isinstance(item, str) and _HEXADECIMAL.match(item) for item in distinct),
    )
    case.compare("renewals", store._renewals())


def flash(case) -> None:
    """Records the result of each call and whether a call failed for a stored value of another form."""
    _storedcalls_of(case)


def kept(case) -> None:
    """Records the result of each call and whether a call failed for a stored value of another form."""
    _storedcalls_of(case)


def _storedcalls_of(case) -> None:
    store = ArraySession()
    for pair in case.input("stored") if case.has("stored") else []:
        key, text = pair
        store.set(key, decoded(text))
    session = Session(store)
    results = []
    error = None
    for method, texts in calls_of(case):
        try:
            results.append(_written(_call(session, method, texts)))
        except ValueError as failure:
            # The stored-value error is exactly ValueError; a subclass is an error of the step.
            if type(failure) is not ValueError:
                raise
            # The error of the data model is also exactly ValueError; its message tells it from the stored-value
            # error (HY-40.4), and only a case that states `failure` expects it.
            message = data_model_message(failure)
            if message is not None:
                if not case.has("failure"):
                    raise
                case.compare("failure", message)
                break
            error = "stored"
            break
    case.compare("results", results)
    case.compare("error", error)


def store(case) -> None:
    """Applies each call to one store in memory held as a session store, with a written call per method, and records
    the value of get and None for the other methods."""
    memory = ArraySession()
    held: SessionStore = memory
    results = []
    for method, texts in calls_of(case):
        arguments = [decoded(text) for text in texts]
        if method == "get":
            results.append(held.get(*arguments))
            continue
        if method == "set":
            held.set(*arguments)
        elif method == "remove":
            held.remove(*arguments)
        elif method == "renew":
            held.renew(*arguments)
        else:
            raise LookupError(f"the method {method} of the case is unknown")
        results.append(None)
    case.compare("results", results)
    case.compare("renewals", memory._renewals())


def _call(session: Session, method: str, texts: list) -> object:
    arguments = [decoded(text) for text in texts]
    if method == "csrfToken":
        return session.csrf_token(*arguments)
    if method == "renew":
        return session.renew(*arguments)
    if method == "takeFlash":
        return session.take_flash(*arguments)
    if method == "putFlash":
        values, changed = arguments
        return session.put_flash(Flash(values, changed))
    if method == "keep":
        return session.keep(*arguments)
    if method == "kept":
        return _pairs(session.kept(*arguments))
    raise LookupError(f"the method {method} of the case is unknown")


def _written(result: object) -> object:
    """The result of a call as the case writes it: a flash is the map of its values as pairs and its topics."""
    if isinstance(result, Flash):
        return {"values": _pairs(result.values), "changed": list(result.changed)}
    return result


def _pairs(values: object) -> object:
    """A map as the list of its pairs in its order, at every depth."""
    if isinstance(values, dict):
        return [[str(key), _pairs(value)] for key, value in values.items()]
    return values
