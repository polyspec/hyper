# The steps of contracts/result.json (HY-25, HY-27, HY-46, HY-50, HY-58): the results of actions and the stops.
from polyspec.hyper.server.bad_request import BadRequest
from polyspec.hyper.server.forbidden import Forbidden
from polyspec.hyper.server.not_found import NotFound
from polyspec.hyper.server.redirect import Redirect
from polyspec.hyper.server.result import Result

from .recorded import decoded


def redirect(case) -> None:
    """Makes a redirect to the location, or records the message of the error with which it fails (HY-46)."""
    result = None
    error = None
    try:
        # `notUtf8` appends a lone surrogate, the unit of a Python string that is not UTF-8 text.
        not_utf8 = case.has("notUtf8") and case.input("notUtf8") is True
        result = Result.redirect(
            _text(case, "location") + ("\ud800" if not_utf8 else "")
        )
    except ValueError as failure:
        error = str(failure)
    case.compare("redirect", None if result is None else result.location)
    case.compare("status", None if result is None else result.status)
    case.compare("error", error)


def page(case) -> None:
    """Makes the page with the status and the data, or records the message of the error with which it fails
    (HY-58)."""
    status = _integer(case, "status")
    data = _data(case, "data")
    result = None
    error = None
    try:
        result = Result.page(status, data)
    except ValueError as failure:
        error = str(failure)
    case.compare("result", None if result is None else result.status)
    case.compare("redirect", None if result is None else result.location)
    if result is not None:
        case.compare("held", result.data)
    case.compare("error", error)


def invalid(case) -> None:
    """Makes the invalid result with the data (HY-26)."""
    result = Result.invalid(_data(case, "data"))
    case.compare("status", result.status)
    case.compare("redirect", result.location)


def copies(case) -> None:
    """Stores the flash values and records the changed topics on a redirect, or records the message of the error of
    the data model with which storing fails (HY-25)."""
    flashes = _list(case, "flashes")
    topics = _list(case, "topics")
    for pair in flashes:
        if (
            not isinstance(pair, list)
            or len(pair) != 2
            or not all(isinstance(item, str) for item in pair)
        ):
            raise TypeError("a flash of the case is not a name and a JSON text")
    # The JSON text gives the value as a handler returns it (HY-44).
    values = [(name, decoded(text)) for name, text in flashes]
    for names in topics:
        if not isinstance(names, list) or not all(
            isinstance(name, str) for name in names
        ):
            raise TypeError("topics of the case are not a list of strings")
    result: Result | None = Result.redirect("/")
    error = None
    try:
        for name, value in values:
            result = result.flash(name, value)
        for names in topics:
            result = result.changed(*names)
    except ValueError as failure:
        result = None
        error = str(failure)
    case.compare("flashValues", None if result is None else result._flash_values)
    case.compare("changedTopics", None if result is None else result._changed_topics)
    case.compare("error", error)


def types(case) -> None:
    """Calls `flash` or `changed` with the decoded argument, and records the message of its TypeError, or None
    (HY-25.6)."""
    call = _text(case, "call")
    if call not in ("flash", "changed"):
        raise ValueError(f"the call {call} of the case is unknown")
    argument = decoded(_text(case, "argument"))
    result = Result.redirect("/")
    error = None
    try:
        if call == "flash":
            result.flash(argument, None)
        else:
            result.changed(argument)
    except TypeError as failure:
        error = str(failure)
    case.compare("error", error)


def stop(case) -> None:
    """Makes the stop of the kind, or records the message of the error with which it fails (HY-27, HY-50)."""
    kind = _text(case, "kind")
    stopped: Exception | None = None
    error = None
    if kind == "NotFound":
        stopped = NotFound()
    elif kind == "Forbidden":
        stopped = Forbidden()
    elif kind == "BadRequest":
        stopped = BadRequest()
    elif kind == "Redirect":
        try:
            stopped = Redirect(
                Result.redirect(_text(case, "redirect"))
                if case.has("redirect")
                else Result.page(_integer(case, "page"), {})
            )
        except ValueError as failure:
            error = str(failure)
    else:
        raise TypeError(f"the stop {kind} of the case is unknown")
    case.compare("message", None if stopped is None else str(stopped))
    if isinstance(stopped, Redirect):
        case.compare("location", stopped.result.location)
    case.compare("error", error)


def _text(case, name: str) -> str:
    value = case.input(name)
    if not isinstance(value, str):
        raise TypeError(f"the case field {name} is not a string")
    return value


def _integer(case, name: str) -> int:
    value = case.input(name)
    if type(value) is not int:
        raise TypeError(f"the case field {name} is not an integer")
    return value


def _list(case, name: str) -> list:
    value = case.input(name)
    if not isinstance(value, list):
        raise TypeError(f"the case field {name} is not a list")
    return value


def _data(case, name: str) -> dict:
    value = case.input(name)
    if not isinstance(value, dict):
        raise TypeError(f"the case field {name} is not a map")
    return value
