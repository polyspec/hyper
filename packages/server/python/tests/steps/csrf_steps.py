# The steps of contracts/csrf.json (HY-24): the masked values of a token and their verification.
import re

from polyspec.hyper._csrf import Csrf


def mask(case) -> None:
    case.compare("value", Csrf.mask(case.input("token"), case.input("mask")))


def verify(case) -> None:
    case.compare("valid", Csrf.verify(case.input("token"), case.input("value")))


def masked(case) -> None:
    token = case.input("token")
    first = Csrf.masked(token)
    second = Csrf.masked(token)
    case.compare("hexadecimal", re.fullmatch(r"[0-9a-f]{128}", first) is not None)
    case.compare("distinct", first != second)
    case.compare("valid", Csrf.verify(token, first) and Csrf.verify(token, second))
