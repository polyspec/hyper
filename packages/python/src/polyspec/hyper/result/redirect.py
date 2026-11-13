"""A loader or an action raises this error to answer the request with the redirect of a result (HY-50)."""

from __future__ import annotations

from .result import Result


class Redirect(Exception):
    """A loader or an action raises this error to answer the request with the redirect of a result (HY-50)."""

    result: Result

    def __init__(self, result: Result):
        """Fails for a result that is not a redirect."""
        if not result._is_redirect():
            raise ValueError("a redirect stop needs a redirect result (HY-50)")
        super().__init__(f"redirect to {result.location}")
        self.result = result
