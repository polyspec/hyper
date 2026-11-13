"""The host of the fixture, which only Python has."""

from polyspec.hyper.session._csrf import Csrf


class Host:
    def serve(self) -> bool:
        return Csrf("k").check()
