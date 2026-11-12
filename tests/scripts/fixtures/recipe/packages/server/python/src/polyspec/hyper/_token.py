"""The token of a JSON text of HY-2."""


class Token:
    def __init__(self) -> None:
        self._seed()

    def text(self) -> str:
        return self.shape()

    def shape(self) -> str:
        return "x"

    def _seed(self) -> None:
        pass
