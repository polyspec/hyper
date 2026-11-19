"""The request step that answers an action whose result the container gives."""

from .result import Result


class App:
    def __init__(self, container: object) -> None:
        self.container = container

    def routed(self) -> int:
        result = self.container.call()
        if result is not None and not isinstance(result, Result):
            raise TypeError("the action did not return a Result")
        if result is not None and result._is_redirect():
            return 303
        return 200
