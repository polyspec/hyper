# The steps of contracts/reply.json (HY-52, HY-60, HY-69, HY-72, HY-92, HY-103): the reply of a request.
from polyspec.hyper.http.reply import Reply

from ..case_rules import FAILURES, raises_of
from .inputs import calls_of
from .recorded import decoded


def call(reply: Reply, method: str, arguments: list) -> None:
    """Applies one call of a case to the reply; every method of the vocabulary is written here."""
    calls = {
        "cookie": reply.cookie,
        "removeCookie": reply.remove_cookie,
        "cacheControl": reply.cache_control,
        "referrerPolicy": reply.referrer_policy,
        "status": reply.status,
        "note": reply.note,
        "renewSession": reply.renew_session,
        "embedData": reply.embed_data,
    }
    if method not in calls:
        raise LookupError(f"the method {method} of the case is unknown")
    calls[method](*arguments)


def cookies(case) -> None:
    """Records the Set-Cookie values of the reply (HY-52)."""
    secure = case.has("secure") and case.input("secure") is True
    case.compare("headers", _applied(case, True)._cookie_headers(secure))


def cache_control(case) -> None:
    """Records the Cache-Control of the reply (HY-52)."""
    case.compare("value", _applied(case, True)._cache_control_value())


def referrer_policy(case) -> None:
    """Records the Referrer-Policy of the reply and its headers (HY-103)."""
    reply = _applied(case, True)
    value = reply._referrer_policy_value()
    case.compare("value", value)
    case.compare("headers", {} if value is None else {"Referrer-Policy": value})


def status(case) -> None:
    """Records the page status of the reply (HY-69)."""
    case.compare("value", _applied(case, True)._status_value())


def notes(case) -> None:
    """Records the notes of the reply (HY-60)."""
    # A pair is a tuple in Python and a list in JSON.
    case.compare("notes", [list(pair) for pair in _applied(case, True).notes()])


def flags(case) -> None:
    """Records the renewal, taken twice, and the embedding of the reply (HY-72, HY-92)."""
    reply = _applied(case, False)
    case.compare("renewals", [reply._take_renewal(), reply._take_renewal()])
    case.compare("embeds", reply._embeds_data())


def _applied(case, compare_failure: bool) -> Reply:
    """Makes a reply and applies the calls of the case in order until one fails, and compares the failure."""
    # The JSON text gives the value as a handler gives it (HY-44); a caller passes the decoded arguments, of any type
    # (HY-52.11).
    calls = [
        (entry[0], [decoded(text) for text in entry[1]]) for entry in calls_of(case)
    ]
    reply = Reply()
    raises = None
    try:
        for method, arguments in calls:
            call(reply, method, arguments)
    except FAILURES as failure:
        raises = raises_of(failure)
    if compare_failure:
        case.compare("raises", raises)
    elif raises is not None:
        raise LookupError(f"a call of the case fails: {raises}")
    return reply
