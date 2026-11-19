"""One HTTP response (HY-52)."""

from __future__ import annotations

from typing import Union

from .reply import Reply


class Response:
    """The status, the headers and the body of one response; `Set-Cookie` holds a list and every other header one
    value."""

    status: int
    headers: dict[str, Union[str, list[str]]]
    body: str

    def __init__(
        self, status: int, headers: dict[str, Union[str, list[str]]], body: str
    ):
        self.status = status
        self.headers = headers
        self.body = body

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

    def _with_session_cookie(self, field: str | None) -> "Response":
        """Returns a copy whose first cookie is the session cookie, when the session sets one (HY-45.8, HY-97.3). The
        host writes it, so the session passes only the field value."""
        if field is None:
            return self
        existing = self.headers.get("Set-Cookie", [])
        return Response(
            self.status,
            {
                **self.headers,
                "Set-Cookie": [
                    field,
                    *(existing if isinstance(existing, list) else []),
                ],
            },
            self.body,
        )

    @staticmethod
    def text(status: int, body: str) -> "Response":
        """Returns a plain text response."""
        return Response(status, {"Content-Type": "text/plain; charset=utf-8"}, body)
