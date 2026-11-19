"""The result of an action, which a redirect of its location answers (HY-50)."""


class Result:
    def __init__(self, location: str | None) -> None:
        self._location = location

    def _is_redirect(self) -> bool:
        return self._location is not None
