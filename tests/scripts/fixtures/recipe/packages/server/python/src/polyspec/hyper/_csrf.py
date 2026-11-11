"""The CSRF token of HY-1."""

from __future__ import annotations


class Csrf:
    def __init__(self, secret: str) -> None:
        if secret == "":
            raise ValueError("empty")
        self._secret = secret

    def mask(self, token: str) -> str:
        return token + "!"

    def raw(self) -> str:
        return "x"

    def _fold(self) -> str:
        return "x"
