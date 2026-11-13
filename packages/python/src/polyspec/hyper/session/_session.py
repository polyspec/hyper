"""The session of one browser session over a store: the CSRF token, the flash values and the kept values (HY-24, HY-25,
HY-40)."""

from __future__ import annotations

import re
import secrets

from ..data._data_model import DataModel
from ._flash import Flash
from .session_store import SessionStore

_TOKEN = re.compile(r"[0-9a-f]{64}\Z")
_TOKEN_KEY = "_hyper_csrf"
_FLASH_KEY = "_hyper_flash"
_KEEP_KEY = "_hyper_keep"


class Session:
    """Owns the CSRF token, the flash data and the kept values of one session (HY-24, HY-25, HY-40)."""

    def __init__(self, store: SessionStore):
        self._store = store

    def csrf_token(self) -> str:
        """Returns the CSRF token, 64 lowercase hexadecimal digits, and creates it on first use or over another
        value (HY-24)."""
        token = self._store.get(_TOKEN_KEY)
        if isinstance(token, str) and _TOKEN.fullmatch(token) is not None:
            return token
        created = secrets.token_bytes(32).hex()
        self._store.set(_TOKEN_KEY, created)
        return created

    def renew(self) -> None:
        """Moves the session to a new identifier and replaces its token (HY-72)."""
        self._store.renew()
        self._store.set(_TOKEN_KEY, secrets.token_bytes(32).hex())

    def take_flash(self) -> Flash:
        """Returns the stored flash data and removes it from the session; stored flash data of another form than the
        session writes fails (HY-104.23)."""
        flash = self._store.get(_FLASH_KEY)
        self._store.remove(_FLASH_KEY)
        if flash is None:
            return Flash({}, [])
        if not isinstance(flash, dict):
            raise ValueError("the session holds flash data that is not a map")
        values = Session._stored_map(flash.get("values", {}))
        changed = flash.get("changed", [])
        if not isinstance(changed, list):
            raise ValueError(
                "the session holds changed topics that are not a list of topics"
            )
        for topic in changed:
            if not isinstance(topic, str):
                raise ValueError(
                    "the session holds a changed topic that is not a string"
                )
        return Flash(values, list(changed))

    def put_flash(self, flash: Flash) -> None:
        """Stores flash data for the next request."""
        self._store.set(_FLASH_KEY, {"values": flash.values, "changed": flash.changed})

    def keep(self, region: str, path: str, value: object) -> None:
        """Stores a kept value of a region (HY-38, HY-40); stored kept values of another form than the session
        writes fail, of every region (HY-104.23). A value outside the data model fails first (HY-40.4)."""
        value = DataModel.check(value)
        stored = self._store.get(_KEEP_KEY)
        kept = {
            name: Session._stored_map(values)
            for name, values in (
                {} if stored is None else Session._stored_map(stored)
            ).items()
        }
        kept.setdefault(region, {})[path] = value
        self._store.set(_KEEP_KEY, kept)

    def kept(self, region: str) -> dict:
        """Returns the kept values of a region by path in storing order, an empty map for a region that stored none
        (HY-40.3); stored kept values of another form than the session writes fail (HY-104.23)."""
        stored = self._store.get(_KEEP_KEY)
        regions = {} if stored is None else Session._stored_map(stored)
        return Session._stored_map(regions[region]) if region in regions else {}

    @staticmethod
    def _stored_map(value: object) -> dict:
        """Returns a copy of the map of a stored value: PHP keeps a map as an array, and an array with the keys 0 to
        n-1 reads as a list, so a list here is that map. A value that is neither fails (HY-104.13, HY-104.23)."""
        if isinstance(value, list):
            return {str(index): item for index, item in enumerate(value)}
        if not isinstance(value, dict):
            raise ValueError(
                "the session holds flash or kept values that are not a map of values"
            )
        return dict(value)
