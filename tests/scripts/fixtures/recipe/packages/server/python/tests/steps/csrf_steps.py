from polyspec.hyper.session._csrf import Csrf


def mask(case) -> None:
    case.compare("expected", _masked("token"))


def _masked(token: str) -> str:
    return Csrf("k").mask(token)
