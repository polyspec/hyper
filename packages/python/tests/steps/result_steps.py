# The steps of contracts/result.json (HY-25, HY-27, HY-46, HY-50, HY-58, HY-132): the results of actions and the stops.
from polyspec.hyper.result.bad_request import BadRequest
from polyspec.hyper.result.forbidden import Forbidden
from polyspec.hyper.result.not_found import NotFound
from polyspec.hyper.result.redirect import Redirect
from polyspec.hyper.result.result import Result

from ..case_rules import FAILURES, raises_of
from .recorded import decoded


def redirect(case) -> None:
    """Makes a redirect to the location, or records the failure with which it fails (HY-46)."""
    # `notUtf8` appends a lone surrogate, the unit of a Python string that is not UTF-8 text.
    not_utf8 = case.has("notUtf8") and case.input("notUtf8") is True
    location = _text(case, "location") + ("\ud800" if not_utf8 else "")
    result = None
    raises = None
    try:
        result = Result.redirect(location)
    except FAILURES as failure:
        raises = raises_of(failure)
    case.compare("redirect", None if result is None else result.location)
    case.compare("status", None if result is None else result.status)
    case.compare("raises", raises)


def outside(case) -> None:
    """Makes an outside redirect to the location, or records the failure with which it fails (HY-132)."""
    location = _text(case, "location")
    result = None
    raises = None
    try:
        result = Result.outside(location)
    except FAILURES as failure:
        raises = raises_of(failure)
    case.compare("outside", None if result is None else result.location)
    case.compare("status", None if result is None else result.status)
    case.compare("raises", raises)


def origin(case) -> None:
    """Records the origin of the text, or None for a text that is no outside location (HY-132)."""
    case.compare("origin", Result.origin(_text(case, "text")))


def outside_stores(case) -> None:
    """Calls `flash` or `changed` of an outside redirect with the decoded argument, and records the failure with which
    it fails (HY-132)."""
    call = _text(case, "call")
    if call not in ("flash", "changed"):
        raise ValueError(f"the call {call} of the case is unknown")
    argument = decoded(_text(case, "argument"))
    result = Result.outside("https://outside.example/")
    case.compare("raises", _stored(result, call, argument))


def page(case) -> None:
    """Makes the page with the status and the data, or records the failure with which it fails (HY-58)."""
    status = _integer(case, "status")
    data = _data(case, "data")
    result = None
    raises = None
    try:
        result = Result.page(status, data)
    except FAILURES as failure:
        raises = raises_of(failure)
    case.compare("result", None if result is None else result.status)
    case.compare("redirect", None if result is None else result.location)
    if result is not None:
        case.compare("held", result.data)
    case.compare("raises", raises)


def invalid(case) -> None:
    """Makes the invalid result with the data (HY-26)."""
    result = Result.invalid(_data(case, "data"))
    case.compare("status", result.status)
    case.compare("redirect", result.location)


def copies(case) -> None:
    """Stores the flash values and records the changed topics on a redirect, or records the failure with which storing
    fails (HY-25)."""
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
    raises = None
    try:
        for name, value in values:
            result = result.flash(name, value)
        for names in topics:
            result = result.changed(*names)
    except FAILURES as failure:
        result = None
        raises = raises_of(failure)
    case.compare("flashValues", None if result is None else result._flash_values)
    case.compare("changedTopics", None if result is None else result._changed_topics)
    case.compare("raises", raises)


def types(case) -> None:
    """Calls `flash` or `changed` with the decoded argument, and records the failure with which it fails, or None
    (HY-25.7)."""
    call = _text(case, "call")
    if call not in ("flash", "changed"):
        raise ValueError(f"the call {call} of the case is unknown")
    argument = decoded(_text(case, "argument"))
    case.compare("raises", _stored(Result.redirect("/"), call, argument))


def stop(case) -> None:
    """Makes the stop of the kind, or records the failure with which it fails (HY-27, HY-50)."""
    kind = _text(case, "kind")
    stopped: Exception | None = None
    raises = None
    if kind == "NotFound":
        stopped = NotFound()
    elif kind == "Forbidden":
        stopped = Forbidden()
    elif kind == "BadRequest":
        stopped = BadRequest()
    elif kind == "Redirect":
        redirect_to = _text(case, "redirect") if case.has("redirect") else None
        outside_to = _text(case, "outside") if case.has("outside") else None
        status = (
            _integer(case, "page")
            if redirect_to is None and outside_to is None
            else None
        )
        try:
            if redirect_to is not None:
                stopped = Redirect(Result.redirect(redirect_to))
            elif outside_to is not None:
                stopped = Redirect(Result.outside(outside_to))
            else:
                stopped = Redirect(Result.page(status, {}))
        except FAILURES as failure:
            raises = raises_of(failure)
    else:
        raise TypeError(f"the stop {kind} of the case is unknown")
    case.compare("message", None if stopped is None else str(stopped))
    if isinstance(stopped, Redirect):
        case.compare("location", stopped.result.location)
    case.compare("raises", raises)


def _stored(result: Result, call: str, argument: object) -> dict | None:
    """Calls `flash` or `changed` of the result with the argument, and returns the failure with which it fails, or
    None."""
    try:
        if call == "flash":
            result.flash(argument, None)
        else:
            result.changed(argument)
    except FAILURES as failure:
        return raises_of(failure)
    return None


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
