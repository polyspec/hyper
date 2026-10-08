"""The results of actions: a redirect (HY-25) or a page with a status (HY-26, HY-58), and the stops of loaders and
actions (HY-27, HY-50, HY-51, HY-58)."""

from __future__ import annotations

import re

from .data_model import check

_PATH = re.compile(r'/(?![/\\])[^\x00-\x20\x7f-\x9f\\]*\Z', re.DOTALL)


class Result:
    """The outcome of an action."""

    def __init__(self, location: str | None, status: int, data: dict, flash: dict, changed_topics: list[str]):
        self.location = location
        self.status = status
        self.data = data
        self.flash = flash
        self.changed_topics = changed_topics

    @staticmethod
    def redirect(location: str) -> 'Result':
        """Returns a redirect to a path of this application (HY-46)."""
        if _PATH.fullmatch(location) is None or _has_dot_segment(location):
            raise ValueError(f'redirect location {location} is not an application path')
        return Result(location, 303, {}, {}, [])

    @staticmethod
    def page(status: int, data: dict) -> 'Result':
        """Returns the route page with a status of 200, 409 or 422 and the data that the page renders (HY-58)."""
        if status not in (200, 409, 422):
            raise ValueError(f'page status {status} is not 200, 409 or 422')
        return Result(None, status, data, {}, [])

    @staticmethod
    def invalid(data: dict) -> 'Result':
        """Returns invalid input with the data that the page renders: the page with status 422 (HY-26)."""
        return Result.page(422, data)

    def flash_value(self, name: str, value: object) -> 'Result':
        """Returns a copy that stores a flash value, a value of the data model, for the next request."""
        check(value)
        return Result(self.location, self.status, self.data, {**self.flash, name: value}, self.changed)

    def changed(self, *topics: str) -> 'Result':
        """Returns a copy that records changed topics for the next request."""
        return Result(self.location, self.status, self.data, self.flash,
                      list(dict.fromkeys([*self.changed_topics, *topics])))

    def is_redirect(self) -> bool:
        """Returns True for a redirect."""
        return self.location is not None


def _has_dot_segment(location: str) -> bool:
    """Returns True when the path of a location has a `.` or `..` segment, also with a percent-encoded dot."""
    path = re.split(r'[?#]', location, 1)[0]
    return any(re.sub('%2e', '.', segment, flags=re.IGNORECASE) in ('.', '..') for segment in path.split('/'))


class NotFound(Exception):
    """A loader or an action raises this error when the requested resource does not exist (HY-27)."""


class Forbidden(Exception):
    """A loader or an action raises this error to answer the request with 403 (HY-51)."""


class BadRequest(Exception):
    """A loader or an action raises this error to answer the request with 400 (HY-58)."""


class Redirect(Exception):
    """A loader or an action raises this error to answer the request with the redirect of a result (HY-50)."""

    def __init__(self, result: Result):
        if not result.is_redirect():
            raise ValueError('a redirect needs a redirect result')
        super().__init__(f'redirect to {result.location}')
        self.result = result
