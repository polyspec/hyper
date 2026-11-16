# The steps of contracts/csrf.json (HY-24): the masked values of a token and their verification.
import re

from polyspec.hyper.session._csrf import Csrf

from ..case_rules import FAILURES, raises_of


def mask(case) -> None:
    """Masks the token with the mask, or records the failure with which it fails (HY-24.9)."""
    token = _string_field(case, "token")
    mask_text = _string_field(case, "mask")
    value = None
    raises = None
    try:
        value = Csrf.mask(token, mask_text)
    except FAILURES as failure:
        raises = raises_of(failure)
    case.compare("value", value)
    case.compare("raises", raises)


def verify(case) -> None:
    """Verifies the value against the token, or records the failure with which it fails (HY-24.9)."""
    token = _string_field(case, "token")
    value = _string_field(case, "value")
    valid = None
    raises = None
    try:
        valid = Csrf.verify(token, value)
    except FAILURES as failure:
        raises = raises_of(failure)
    case.compare("valid", valid)
    case.compare("raises", raises)


def masked(case) -> None:
    token = _string_field(case, "token")
    first = Csrf.masked(token)
    second = Csrf.masked(token)
    case.compare("hexadecimal", re.fullmatch(r"[0-9a-f]{128}", first) is not None)
    case.compare("distinct", first != second)
    case.compare("valid", Csrf.verify(token, first) and Csrf.verify(token, second))


def browser(case) -> None:
    """Gives the digest of the masked value, or records the failure with which it fails (HY-24.13)."""
    value = _string_field(case, "value")
    result = None
    raises = None
    try:
        result = Csrf.browser_of(value)
    except FAILURES as failure:
        raises = raises_of(failure)
    case.compare("browser", result)
    case.compare("raises", raises)


def _string_field(case, name: str) -> str:
    """Returns a string field of a case, and fails for any other value."""
    value = case.input(name)
    if not isinstance(value, str):
        raise TypeError(f"the case field {name} is not a string")
    return value
