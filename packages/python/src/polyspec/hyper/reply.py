"""The cookies, the cache control, the page status and the embedding of the data that the loaders and actions of one
request give its response (HY-52, HY-69, HY-92), and the notes that they give the response hook (HY-60)."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
import re

_COOKIE_NAME = re.compile(r"[a-z][a-z0-9_-]*\Z")
_COOKIE_VALUE = re.compile(r"[A-Za-z0-9._~-]+\Z")
_CACHE_CONTROL = re.compile(r"[\x20-\x7e]+\Z")
# The tokens of the Referrer-Policy specification that a reply may set (HY-103).
_REFERRER_POLICIES = (
    "no-referrer",
    "no-referrer-when-downgrade",
    "origin",
    "origin-when-cross-origin",
    "same-origin",
    "strict-origin",
    "strict-origin-when-cross-origin",
    "unsafe-url",
)


@dataclass(eq=False)
class Reply:
    """The reply of one request."""

    # One cookie: name, value and Max-Age (HY-52).
    __cookies: list[tuple[str, str, int | None]] = field(
        default_factory=list, init=False
    )
    __cache_control: str | None = field(default=None, init=False)
    __referrer_policy: str | None = field(default=None, init=False)
    __renewal: bool = field(default=False, init=False)
    __status: int | None = field(default=None, init=False)
    __embed: bool = field(default=False, init=False)
    __notes: dict[str, object] = field(default_factory=dict, init=False)

    def note(self, name: str, value: object) -> "Reply":
        """Records a value of the request for the response hook; a later note of the same name replaces the value
        and keeps its position. The notes are not part of the response (HY-60)."""
        if not isinstance(name, str):
            raise TypeError("a note name is not a string (HY-60)")
        self.__notes[name] = value
        return self

    def notes(self) -> list[tuple[str, object]]:
        """Returns the notes as pairs of a name and its value, in the order of their first names (HY-60.29)."""
        return list(self.__notes.items())

    def cookie(self, name: str, value: str, max_age: int | None = None) -> "Reply":
        """Adds a cookie; a name, value or Max-Age of another type (HY-52.11) or outside HY-52 (HY-52.12) fails.
        The types are checked before the values, in the order of the parameters."""
        if not isinstance(name, str):
            raise TypeError("a cookie name is not a string (HY-52)")
        if not isinstance(value, str):
            raise TypeError("a cookie value is not a string (HY-52)")
        age = None if max_age is None else Reply._integer(max_age)
        if max_age is not None and age is None:
            raise TypeError("a Max-Age is not an integer within ±(2^53 − 1) (HY-52)")
        if _COOKIE_NAME.fullmatch(name) is None or name.startswith("hy-"):
            raise ValueError(f"cookie name {name} is not allowed (HY-52)")
        if _COOKIE_VALUE.fullmatch(value) is None:
            raise ValueError(
                f"cookie value of {name} has a character that is not allowed (HY-52)"
            )
        if age is not None and age < 0:
            raise ValueError(f"cookie {name} has a negative Max-Age (HY-52)")
        self.__cookies.append((name, value, age))
        return self

    def remove_cookie(self, name: str) -> "Reply":
        """Removes a cookie with Max-Age=0."""
        self.cookie(name, "x")
        self.__cookies[-1] = (name, "", 0)
        return self

    def cache_control(self, value: str) -> "Reply":
        """Sets the Cache-Control of a page response with status 200. A page carries the session token of its
        visitor, so the value keeps it out of shared caches: it has `private` or `no-store` and neither `public` nor
        `s-maxage` (HY-52)."""
        if not isinstance(value, str):
            raise TypeError("a Cache-Control is not a string (HY-52)")
        if _CACHE_CONTROL.fullmatch(value) is None:
            raise ValueError(
                "Cache-Control has a character that is not allowed (HY-52)"
            )
        directives = [
            part.split("=", 1)[0].strip().lower() for part in value.split(",")
        ]
        if not any(name in ("private", "no-store") for name in directives) or any(
            name in ("public", "s-maxage") for name in directives
        ):
            raise ValueError(
                f"Cache-Control {value} lets a shared cache store the page; "
                "it needs private or no-store and neither public nor s-maxage (HY-52)"
            )
        self.__cache_control = value
        return self

    def renew_session(self) -> "Reply":
        """Renews the session after the action of the request returns (HY-72)."""
        self.__renewal = True
        return self

    def _take_renewal(self) -> bool:
        """Returns whether a renewal was requested since the last call, and clears the request."""
        renewal = self.__renewal
        self.__renewal = False
        return renewal

    def _cache_control_value(self) -> str | None:
        """Returns the Cache-Control that the reply sets, or None."""
        return self.__cache_control

    def referrer_policy(self, value: str) -> "Reply":
        """Sets the Referrer-Policy of the page and JSON answers of the request, whatever their status; a value that is
        not a token of the Referrer-Policy specification fails (HY-103)."""
        if not isinstance(value, str):
            raise TypeError("a Referrer-Policy is not a string (HY-103)")
        if value not in _REFERRER_POLICIES:
            raise ValueError(
                f"Referrer-Policy {value} is not a token of the Referrer-Policy specification (HY-103)"
            )
        self.__referrer_policy = value
        return self

    def _referrer_policy_value(self) -> str | None:
        """Returns the Referrer-Policy that the reply sets, or None."""
        return self.__referrer_policy

    def _referrer_policy_headers(self) -> dict[str, str]:
        """Returns the Referrer-Policy header of the reply, or no header (HY-103)."""
        return (
            {}
            if self.__referrer_policy is None
            else {"Referrer-Policy": self.__referrer_policy}
        )

    def status(self, status: int) -> "Reply":
        """Gives a page response that has status 200 otherwise the status 403, for a page that shows other data in
        place of the data that the request may not see; another status fails (HY-69)."""
        code = Reply._integer(status)
        if code is None:
            raise TypeError(
                "a page status of a reply is not an integer within ±(2^53 − 1) (HY-69)"
            )
        if code != 403:
            raise ValueError(f"page status {code} of a reply is not 403 (HY-69)")
        self.__status = code
        return self

    def _status_value(self) -> int | None:
        """Returns the page status that the reply sets, or None."""
        return self.__status

    def embed_data(self) -> "Reply":
        """Makes the HTML document of the response embed its data (HY-31, HY-92)."""
        self.__embed = True
        return self

    def _embeds_data(self) -> bool:
        """Returns whether the HTML document of the response embeds its data (HY-92)."""
        return self.__embed

    def _cookie_headers(self, secure: bool) -> list[str]:
        """Returns the Set-Cookie values of the cookies of the reply (HY-52)."""
        return [
            f"{name}={value}; Path=/; HttpOnly; SameSite=Lax"
            f"{'; Secure' if secure else ''}{'' if max_age is None else f'; Max-Age={max_age}'}"
            for name, value, max_age in self.__cookies
        ]

    @staticmethod
    def _integer(value: object) -> int | None:
        """Returns an integer of the data model, or None for another value: an int or a float within ±(2^53 − 1)
        without a fraction, as Node takes a number; a bool is not one (HY-44)."""
        if isinstance(value, bool):
            return None
        if isinstance(value, int):
            return value if -9007199254740991 <= value <= 9007199254740991 else None
        if (
            isinstance(value, float)
            and math.isfinite(value)
            and value.is_integer()
            and abs(value) <= 9007199254740991
        ):
            return int(value)
        return None
