"""One HTTP response (HY-52)."""

from __future__ import annotations

from typing import Union

from .reply import Reply


class Response:
    """The status, the headers and the body of one response; `Set-Cookie` holds a list and every other header one
    value."""

    def __init__(
        self, status: int, headers: dict[str, Union[str, list[str]]], body: str
    ):
        self._status = status
        self._headers = headers
        self._body = body

    @property
    def status(self) -> int:
        """The status of the response."""
        return self._status

    @property
    def headers(self) -> dict[str, Union[str, list[str]]]:
        """The headers of the response."""
        return self._headers

    @property
    def body(self) -> str:
        """The body of the response."""
        return self._body

    def with_header(self, name: str, value: str) -> "Response":
        """Returns a copy with one more header."""
        return Response(self.status, {**self.headers, name: value}, self.body)

    def _with_cookies(self, reply: Reply, secure: bool) -> "Response":
        """Returns a copy with the cookies of a reply, when it has any (HY-52)."""
        cookies = reply._cookie_headers(secure)
        return (
            self
            if cookies == []
            else Response(
                self.status, {**self.headers, "Set-Cookie": cookies}, self.body
            )
        )

    @staticmethod
    def text(status: int, body: str) -> "Response":
        """Returns a plain text response."""
        return Response(status, {"Content-Type": "text/plain; charset=utf-8"}, body)
