# The steps of contracts/cookies.json (HY-29 to HY-31): the cookies of a Cookie header.
from polyspec.hyper._cookies import parse


def _header_bytes(header):
    # The header text has one character per byte (U+0000 to U+00FF); null is a request without the header.
    return None if header is None else header.encode("latin-1")


def parse_cookies(case) -> None:
    case.compare("cookies", parse(_header_bytes(case.input("header"))))
