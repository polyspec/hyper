# The steps of contracts/reply.json (HY-52, HY-60, HY-69, HY-72, HY-92, HY-103): the reply of a request.
from polyspec.hyper.reply import Reply

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
    case.compare("value", reply._referrer_policy_value())
    case.compare("headers", reply._referrer_policy_headers())


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
    """Makes a reply and applies the calls of the case in order until one fails, and compares the message and the
    class of the failure: `type` for a TypeError and `value` for the ValueError of HY-46.2."""
    calls = calls_of(case)
    reply = Reply()
    error = None
    kind = None
    try:
        for entry in calls:
            # The JSON text gives the value as a handler gives it (HY-44); a caller passes the decoded arguments, of
            # any type (HY-52.11).
            call(reply, entry[0], [decoded(text) for text in entry[1]])
    except TypeError as failure:
        kind = "type"
        error = str(failure)
    except ValueError as failure:
        kind = "value"
        error = str(failure)
    if compare_failure:
        case.compare("error", error)
        case.compare("class", kind)
    elif error is not None:
        raise LookupError(f"a call of the case fails: {error}")
    return reply
