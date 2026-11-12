# The steps of contracts/csrf.json (HY-24): the masked values of a token and their verification.
import re

from polyspec.hyper._csrf import Csrf


def mask(case) -> None:
    """Masks the token with the mask, or records the message of the error with which it fails (HY-24.9)."""
    token = _string_field(case, "token")
    mask_text = _string_field(case, "mask")
    value = None
    error = None
    try:
        value = Csrf.mask(token, mask_text)
    except ValueError as failure:
        error = str(failure)
    case.compare("value", value)
    case.compare("error", error)


def verify(case) -> None:
    """Verifies the value against the token, or records the message of the error with which it fails (HY-24.9)."""
    token = _string_field(case, "token")
    value = _string_field(case, "value")
    valid = None
    error = None
    try:
        valid = Csrf.verify(token, value)
    except ValueError as failure:
        error = str(failure)
    case.compare("valid", valid)
    case.compare("error", error)


def masked(case) -> None:
    token = _string_field(case, "token")
    first = Csrf.masked(token)
    second = Csrf.masked(token)
    case.compare("hexadecimal", re.fullmatch(r"[0-9a-f]{128}", first) is not None)
    case.compare("distinct", first != second)
    case.compare("valid", Csrf.verify(token, first) and Csrf.verify(token, second))


def browser(case) -> None:
    """Gives the digest of the masked value, or records the message of the error with which it fails (HY-24.13)."""
    value = _string_field(case, "value")
    result = None
    error = None
    try:
        result = Csrf.browser_of(value)
    except ValueError as failure:
        error = str(failure)
    case.compare("browser", result)
    case.compare("error", error)


def _string_field(case, name: str) -> str:
    """Returns a string field of a case, and fails for any other value."""
    value = case.input(name)
    if not isinstance(value, str):
        raise TypeError(f"the case field {name} is not a string")
    return value
