"""The cookies, the cache control, the page status and the embedding of the data that the loaders and actions of one
request give its response (HY-52, HY-69, HY-92), and the notes that they give the response hook (HY-60)."""

from __future__ import annotations

import re

_COOKIE_NAME = re.compile(r'[a-z][a-z0-9_-]*\Z')
_COOKIE_VALUE = re.compile(r'[A-Za-z0-9._~-]+\Z')
_CACHE_CONTROL = re.compile(r'[\x20-\x7e]+\Z')


class Reply:
    """The reply of one request."""

    def __init__(self):
        # One cookie: name, value and Max-Age (HY-52).
        self._cookies: list[tuple[str, str, int | None]] = []
        self._cache_control: str | None = None
        self._renewal = False
        self._status: int | None = None
        self._embed = False
        self._notes: dict[str, object] = {}

    def note(self, name: str, value: object) -> 'Reply':
        """Records a value of the request for the response hook; a later note of the same name replaces the value
        and keeps its position. The notes are not part of the response (HY-60)."""
        self._notes[name] = value
        return self

    def notes(self) -> dict[str, object]:
        """Returns the notes in the order of their first names."""
        return dict(self._notes)

    def cookie(self, name: str, value: str, max_age: int | None = None) -> 'Reply':
        """Adds a cookie; a name or value outside HY-52 fails."""
        if _COOKIE_NAME.fullmatch(name) is None or name.startswith('hy-'):
            raise ValueError(f'cookie name {name} is not allowed')
        if _COOKIE_VALUE.fullmatch(value) is None:
            raise ValueError(f'cookie value of {name} has a character that is not allowed')
        if max_age is not None and max_age < 0:
            raise ValueError(f'cookie {name} has a negative Max-Age')
        self._cookies.append((name, value, max_age))
        return self

    def remove_cookie(self, name: str) -> 'Reply':
        """Removes a cookie with Max-Age=0."""
        self.cookie(name, 'x')
        self._cookies[-1] = (name, '', 0)
        return self

    def cache_control(self, value: str) -> 'Reply':
        """Sets the Cache-Control of a page response with status 200. A page carries the session token of its
        visitor, so the value keeps it out of shared caches: it has `private` or `no-store` and neither `public` nor
        `s-maxage` (HY-52)."""
        if _CACHE_CONTROL.fullmatch(value) is None:
            raise ValueError('Cache-Control has a character that is not allowed')
        directives = [part.split('=', 1)[0].strip().lower() for part in value.split(',')]
        if not any(name in ('private', 'no-store') for name in directives) \
                or any(name in ('public', 's-maxage') for name in directives):
            raise ValueError(f'Cache-Control {value} lets a shared cache store the page; '
                             'it needs private or no-store and neither public nor s-maxage')
        self._cache_control = value
        return self

    def renew_session(self) -> 'Reply':
        """Renews the session after the action of the request returns (HY-72)."""
        self._renewal = True
        return self

    def take_renewal(self) -> bool:
        """Returns whether a renewal was requested since the last call, and clears the request."""
        renewal = self._renewal
        self._renewal = False
        return renewal

    def cache_control_value(self) -> str | None:
        """Returns the Cache-Control that the reply sets, or None."""
        return self._cache_control

    def status(self, status: int) -> 'Reply':
        """Gives a page response that has status 200 otherwise the status 403, for a page that shows other data in
        place of the data that the request may not see; another status fails (HY-69)."""
        if status != 403:
            raise ValueError(f'page status {status} of a reply is not 403')
        self._status = status
        return self

    def status_value(self) -> int | None:
        """Returns the page status that the reply sets, or None."""
        return self._status

    def embed_data(self) -> 'Reply':
        """Makes the HTML document of the response embed its data (HY-31, HY-92)."""
        self._embed = True
        return self

    def embeds_data(self) -> bool:
        """Returns whether the HTML document of the response embeds its data (HY-92)."""
        return self._embed

    def cookie_headers(self, secure: bool) -> list[str]:
        """Returns the Set-Cookie values of the cookies of the reply (HY-52)."""
        return [f'{name}={value}; Path=/; HttpOnly; SameSite=Lax'
                f"{'; Secure' if secure else ''}{'' if max_age is None else f'; Max-Age={max_age}'}"
                for name, value, max_age in self._cookies]
