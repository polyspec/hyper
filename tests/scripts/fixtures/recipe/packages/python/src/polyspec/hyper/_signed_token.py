"""The signed token of a JSON text of HY-2."""

from polyspec.hyper._token import Token


class SignedToken(Token):
    def __init__(self) -> None:
        super().__init__()

    @staticmethod
    def all() -> list[Token]:
        return [SignedToken()]

    def shape(self) -> str:
        return self._sign()

    def _sign(self) -> str:
        return "y"
