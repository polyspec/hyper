"""The cookies, the cache control, the page status and the embedding of the data that the loaders and actions of one
request give its response (HY-52, HY-69, HY-92), and the notes that they give the response hook (HY-60)."""

from __future__ import annotations

from dataclasses import dataclass, field
import re

from ..app._core_rules import core_rules

_COOKIE_NAME = re.compile(r"[a-z][a-z0-9_-]*\Z")
_COOKIE_VALUE = re.compile(r"[A-Za-z0-9._~-]+\Z")


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
            raise core_rules().type_error(
                "a note name is not a string (HY-60)", "invalid_argument_type"
            )
        self.__notes[name] = value
        return self

    def notes(self) -> list[tuple[str, object]]:
        """Returns the notes as pairs of a name and its value, in the order of their first names (HY-60.29)."""
        return list(self.__notes.items())

    def cookie(self, name: str, value: str, max_age: int | None = None) -> "Reply":
        """Adds a cookie; a name, value or Max-Age of another type (HY-52.11) or outside HY-52 (HY-52.12) fails.
        The types are checked before the values, in the order of the parameters."""
        if not isinstance(name, str):
            raise core_rules().type_error(
                "a cookie name is not a string (HY-52)", "invalid_argument_type"
            )
        if not isinstance(value, str):
            raise core_rules().type_error(
                "a cookie value is not a string (HY-52)", "invalid_argument_type"
            )
        age = None if max_age is None else Reply._integer(max_age)
        if max_age is not None and age is None:
            raise core_rules().value_error(
                "a Max-Age is not an integer within ±(2^53 − 1) (HY-52)",
                "invalid_number",
            )
        if _COOKIE_NAME.fullmatch(name) is None or name.startswith("hy-"):
            raise core_rules().value_error(
                f"cookie name {name} is not allowed (HY-52)", "cookie_name_not_allowed"
            )
        if _COOKIE_VALUE.fullmatch(value) is None:
            raise core_rules().value_error(
                f"cookie value of {name} has a character that is not allowed (HY-52)",
                "cookie_value_not_allowed",
            )
        if age is not None and age < 0:
            raise core_rules().value_error(
                f"cookie {name} has a negative Max-Age (HY-52)", "negative_max_age"
            )
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
        `s-maxage` (HY-52); the core checks the value (HY-133.2)."""
        if not isinstance(value, str):
            raise core_rules().type_error(
                "a Cache-Control is not a string (HY-52)", "invalid_argument_type"
            )
        self.__cache_control = core_rules().reply_cache_control(value)
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
        not a token of the Referrer-Policy specification fails (HY-103); the core checks the value (HY-133.2)."""
        if not isinstance(value, str):
            raise core_rules().type_error(
                "a Referrer-Policy is not a string (HY-103)", "invalid_argument_type"
            )
        self.__referrer_policy = core_rules().reply_referrer_policy(value)
        return self

    def _referrer_policy_value(self) -> str | None:
        """Returns the Referrer-Policy that the reply sets, or None."""
        return self.__referrer_policy

    def status(self, status: int) -> "Reply":
        """Gives a page response that has status 200 otherwise the status 403, for a page that shows other data in
        place of the data that the request may not see; another status fails (HY-69). A status that is no integer
        of the data model fails with `invalid_number` before the core is called, because the binding refuses a value
        of another type with `invalid_argument_type`; the core checks the status (HY-133.2)."""
        code = Reply._integer(status)
        if code is None:
            raise core_rules().value_error(
                "a page status of a reply is not an integer within ±(2^53 − 1) (HY-69)",
                "invalid_number",
            )
        self.__status = core_rules().reply_status(code)
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
            f"{name}={value}{'' if max_age is None else f'; Max-Age={max_age}'}; Path=/"
            f"{'; Secure' if secure else ''}; HttpOnly; SameSite=Lax"
            for name, value, max_age in self.__cookies
        ]

    @staticmethod
    def _integer(value: object) -> int | None:
        """Returns an integer of the data model, or None for another value: an int within ±(2^53 − 1); a float,
        even without a fraction, and a bool are not one (HY-52.20)."""
        if isinstance(value, bool):
            return None
        if isinstance(value, int):
            return value if -9007199254740991 <= value <= 9007199254740991 else None
        return None
