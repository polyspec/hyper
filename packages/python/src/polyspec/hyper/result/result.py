"""The outcome of an action: a redirect (HY-25, HY-46), an outside redirect (HY-133) or a page with a status (HY-26,
HY-58), with the flash values and the changed topics that it stores for the next request."""

from __future__ import annotations

import re

from ..app._core_rules import core_rules
from ..data._data_model import DataModel

# A lone surrogate is not UTF-8 text, so that a location holds none (HY-46).
_PATH = re.compile(r"/(?![/\\])[^\x00-\x20\x7f-\x9f\\\ud800-\udfff]*\Z", re.DOTALL)

# An outside location (HY-133.2) with its scheme, its host and its port, of ASCII characters only: the class of the rest
# holds every visible ASCII character except the backslash.
_OUTSIDE = re.compile(
    r"([Hh][Tt][Tt][Pp][Ss]?)://([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)(?::([1-9][0-9]{0,4}))?"
    r"(?:[/?#][\x21-\x5b\x5d-\x7e]*)?\Z"
)


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
        """Returns a redirect to a path of this application (HY-46)."""
        if _PATH.fullmatch(location) is None or Result._has_dot_segment(location):
            raise ValueError("a redirect location is not an application path (HY-46)")
        return Result(location, 303, {}, {}, [])

    @staticmethod
    def outside(location: str) -> Result:
        """Returns an outside redirect to an outside location (HY-133)."""
        if Result.origin(location) is None:
            raise ValueError(
                "an outside location is not an http or https URL with a host (HY-133)"
            )
        return Result(location, 303, {}, {}, [])

    @staticmethod
    def origin(text: str) -> str | None:
        """Returns the origin of an outside location, its scheme and its host in lower case and its port or the default
        port of its scheme, or None for a text that is no outside location (HY-133)."""
        parts = _OUTSIDE.fullmatch(text)
        if parts is None:
            return None
        scheme = parts.group(1).lower()
        port = (
            (443 if scheme == "https" else 80)
            if parts.group(3) is None
            else int(parts.group(3))
        )
        if port > 65535:
            return None
        return f"{scheme}://{parts.group(2).lower()}:{port}"

    @staticmethod
    def page(status: int, data: dict) -> Result:
        """Returns the route page with a status of 200, 409 or 422 and the data that the page renders (HY-58); the core
        checks the status (HY-132.2)."""
        return Result(None, core_rules().result_page(status), data, {}, [])

    @staticmethod
    def invalid(data: dict) -> Result:
        """Returns invalid input with the data that the page renders: the page with status 422 (HY-26)."""
        return Result.page(422, data)

    def flash(self, name: str, value: object) -> Result:
        """Returns a copy that stores a flash value, a value of the data model, for the next request; a value outside
        the data model fails (HY-44), and a name that is not a string fails with TypeError (HY-25.6)."""
        self._refuse_outside()
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
        self._refuse_outside()
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

    def _is_outside(self) -> bool:
        """Returns True for an outside redirect, whose location is no application path (HY-133)."""
        return self.location is not None and not self.location.startswith("/")

    def _refuse_outside(self) -> None:
        """Fails for an outside redirect, which stores no flash value and no changed topic (HY-133)."""
        if self._is_outside():
            raise ValueError(
                "an outside redirect holds no flash value or changed topic (HY-133)"
            )

    @staticmethod
    def _has_dot_segment(location: str) -> bool:
        """Returns True when the path of a location has a `.` or `..` segment, also with a percent-encoded dot."""
        path = re.split(r"[?#]", location, maxsplit=1)[0]
        return any(
            re.sub("%2e", ".", segment, flags=re.IGNORECASE) in (".", "..")
            for segment in path.split("/")
        )
