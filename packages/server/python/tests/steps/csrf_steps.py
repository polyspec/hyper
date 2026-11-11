# The steps of contracts/csrf.json (HY-24): the masked values of a token and their verification.
from polyspec.hyper._csrf import mask, verify


def mask_token(case) -> None:
    case.compare("value", mask(case.input("token"), case.input("mask")))


def verify_value(case) -> None:
    case.compare("valid", verify(case.input("token"), case.input("value")))
