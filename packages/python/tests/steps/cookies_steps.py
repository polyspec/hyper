# The steps of contracts/cookies.json (HY-129): each line is text whose characters U+0000 to U+00FF are its bytes, and
# `header` is one line, as a host whose runtime joins the lines passes it (HY-129.15).
from polyspec.hyper.http._cookies import Cookies


def parse(case) -> None:
    if case.has("lines"):
        lines = list(case.input("lines"))
    else:
        header = case.input("header")
        lines = [] if header is None else [header]
    case.compare("cookies", Cookies.parse(lines))
