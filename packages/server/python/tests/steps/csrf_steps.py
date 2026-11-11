# The steps of contracts/csrf.json (HY-24): the masked values of a token and their verification.
import re

from polyspec.hyper._csrf import Csrf


def mask(case) -> None:
    case.compare(
        "value", Csrf.mask(_string_field(case, "token"), _string_field(case, "mask"))
    )


def verify(case) -> None:
    case.compare(
        "valid",
        Csrf.verify(_string_field(case, "token"), _string_field(case, "value")),
    )


def masked(case) -> None:
    token = _string_field(case, "token")
    first = Csrf.masked(token)
    second = Csrf.masked(token)
    case.compare("hexadecimal", re.fullmatch(r"[0-9a-f]{128}", first) is not None)
    case.compare("distinct", first != second)
    case.compare("valid", Csrf.verify(token, first) and Csrf.verify(token, second))


def _string_field(case, name: str) -> str:
    """Returns a string field of a case, and fails for any other value."""
    value = case.input(name)
    if not isinstance(value, str):
        raise TypeError(f"the case field {name} is not a string")
    return value
