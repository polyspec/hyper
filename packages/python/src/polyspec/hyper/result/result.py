"""The outcome of an action: a redirect (HY-25, HY-46) or a page with a status (HY-26, HY-58), with the flash values
and the changed topics that it stores for the next request."""

from __future__ import annotations

from ..app._core import core
from ..data._data_model import DataModel


class Result:
    """The outcome of an action."""

    location: str | None
    status: int
    data: dict
    _flash_values: dict
    _changed_topics: list[str]

    def __init__(
        self,
        location: str | None,
        status: int,
        data: dict,
        flash_values: dict,
        changed_topics: list[str],
    ):
        self.location = location
        self.status = status
        self.data = data
        self._flash_values = flash_values
        self._changed_topics = changed_topics

    @staticmethod
    def redirect(location: str) -> Result:
        """Returns a redirect to a path of this application (HY-46). The core decides the location."""
        return Result(core().Result.redirect(location), 303, {}, {}, [])

    @staticmethod
    def page(status: int, data: dict) -> Result:
        """Returns the route page with a status of 200, 409 or 422 and the data that the page renders (HY-58). The core
        decides the status."""
        return Result(None, core().Result.page(status), data, {}, [])

    @staticmethod
    def invalid(data: dict) -> Result:
        """Returns invalid input with the data that the page renders: the page with status 422 (HY-26)."""
        return Result.page(422, data)

    def flash(self, name: str, value: object) -> Result:
        """Returns a copy that stores a flash value, a value of the data model, for the next request; a value outside
        the data model fails (HY-44), and a name that is not a string fails with TypeError (HY-25.6)."""
        if not isinstance(name, str):
            raise TypeError("a flash name is not a string (HY-25)")
        DataModel.check(value)
        return Result(
            self.location,
            self.status,
            self.data,
            {**self._flash_values, name: value},
            self._changed_topics,
        )

    def changed(self, *topics: str) -> Result:
        """Returns a copy that records changed topics for the next request; a topic that it records already keeps its
        place; a topic that is not a string fails with TypeError (HY-25.6)."""
        if not all(isinstance(topic, str) for topic in topics):
            raise TypeError("a changed topic is not a string (HY-25)")
        return Result(
            self.location,
            self.status,
            self.data,
            self._flash_values,
            list(dict.fromkeys([*self._changed_topics, *topics])),
        )

    def _is_redirect(self) -> bool:
        """Returns True for a redirect."""
        return self.location is not None
