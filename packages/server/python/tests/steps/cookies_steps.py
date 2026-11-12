# The steps of contracts/cookies.json (HY-129): a header is text whose characters U+0000 to U+00FF are its bytes.
from polyspec.hyper.server._cookies import Cookies


def parse(case) -> None:
    header = case.input("header")
    data = header.encode("latin-1") if isinstance(header, str) else None
    case.compare("cookies", Cookies.parse(data))
