# The steps of contracts/session.json (HY-24, HY-25, HY-40, HY-72, HY-104): the token, the flash values and the kept
# values of one session over a new store in memory.
import json
import re

from polyspec.hyper._flash import Flash
from polyspec.hyper._session import Session
from polyspec.hyper.array_session import ArraySession

_HEXADECIMAL = re.compile(r"[0-9a-f]{64}\Z")


def token(case) -> None:
    """Records the number of each token among the distinct tokens, their form and the renewals of the store."""
    store = ArraySession()
    session = Session(store)
    distinct: list[str] = []
    numbers = []
    for method, texts in _calls(case):
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
    _stored_calls(case)


def kept(case) -> None:
    """Records the result of each call and whether a call failed for a stored value of another form."""
    _stored_calls(case)


def _stored_calls(case) -> None:
    store = ArraySession()
    for pair in case.input("stored") if case.has("stored") else []:
        key, text = pair
        store.set(key, _value(text))
    session = Session(store)
    results = []
    error = None
    for method, texts in _calls(case):
        try:
            results.append(_written(_call(session, method, texts)))
        except ValueError as failure:
            # The stored-value error is exactly ValueError; a subclass is an error of the step.
            if type(failure) is not ValueError:
                raise
            error = "stored"
            break
    case.compare("results", results)
    case.compare("error", error)


def _calls(case) -> list:
    calls = case.input("calls")
    for entry in calls:
        if (
            not isinstance(entry, list)
            or len(entry) != 2
            or not isinstance(entry[0], str)
            or not isinstance(entry[1], list)
        ):
            raise LookupError(
                "a call of the case is not a method and a list of JSON texts"
            )
    return calls


def _call(session: Session, method: str, texts: list) -> object:
    arguments = [_value(text) for text in texts]
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


def _value(text: object) -> object:
    if not isinstance(text, str):
        raise LookupError("an argument of the case is not a JSON text")
    return json.loads(text, parse_constant=_reject)


def _reject(name: str) -> None:
    raise LookupError(f"the JSON text {name} is not a value of the case")
