"""The session of one browser session over a store: the CSRF token, the flash values and the kept values (HY-24, HY-25,
HY-40)."""

from __future__ import annotations

import secrets

from ..app._core_rules import core_rules
from ..data._data_model import DataModel
from ._flash import Flash
from .session_store import SessionStore

_TOKEN_KEY = "_hyper_csrf"
_FLASH_KEY = "_hyper_flash"
_KEEP_KEY = "_hyper_keep"


class Session:
    """Owns the CSRF token, the flash data and the kept values of one session (HY-24, HY-25, HY-40)."""

    def __init__(self, store: SessionStore):
        self._store = store

    def csrf_token(self) -> str:
        """Returns the CSRF token, 64 lowercase hexadecimal digits, and creates it on first use (HY-24.1). A stored
        text of another form fails, which the core checks (HY-24.14, HY-132.2)."""
        token = self._store.get(_TOKEN_KEY)
        if isinstance(token, str):
            return core_rules().session_stored_token(token)
        created = secrets.token_bytes(32).hex()
        self._store.set(_TOKEN_KEY, created)
        return created

    def renew(self) -> None:
        """Moves the session to a new identifier and replaces its token (HY-72)."""
        self._store.renew()
        self._store.set(_TOKEN_KEY, secrets.token_bytes(32).hex())

    def take_flash(self) -> Flash:
        """Returns the stored flash data and removes it from the session. rules.flash_of of the core checks the stored
        flash first and fails with ``invalid_session_record`` for one of another form (HY-25.2, HY-104.23)."""
        stored = self._store.get(_FLASH_KEY)
        if stored is None:
            # HY-120.6: the opening of the session reads and removes the flash data, also when it holds none.
            self._store.remove(_FLASH_KEY)
            return Flash({}, [])
        flash = Session._core_map(core_rules().session_flash_of(stored))
        self._store.remove(_FLASH_KEY)
        changed = flash.get("changed", [])
        topics = (
            [topic for topic in changed if isinstance(topic, str)]
            if isinstance(changed, list)
            else []
        )
        return Flash(Session._core_map(flash.get("values", {})), topics)

    def put_flash(self, flash: Flash) -> None:
        """Stores flash data for the next request."""
        self._store.set(_FLASH_KEY, {"values": flash.values, "changed": flash.changed})

    def keep(self, region: str, path: str, value: object) -> None:
        """Stores a kept value of a region (HY-38, HY-40); rules.kept_of of the core checks the stored kept values,
        of every region (HY-104.23). A value outside the data model fails first (HY-40.4)."""
        value = DataModel.check(value)
        kept = {
            name: Session._core_map(values)
            for name, values in self._stored_kept().items()
        }
        kept.setdefault(region, {})[path] = value
        self._store.set(_KEEP_KEY, kept)

    def kept(self, region: str) -> dict:
        """Returns the kept values of a region by path in storing order, an empty map for a region that stored none
        (HY-40.3); rules.kept_of of the core checks the stored kept values (HY-104.23)."""
        regions = self._stored_kept()
        return Session._core_map(regions[region]) if region in regions else {}

    def _stored_kept(self) -> dict:
        """The stored kept values by region, which rules.kept_of of the core checks and which fail with
        ``invalid_session_record`` for kept values of another form (HY-104.22, HY-104.23)."""
        stored = self._store.get(_KEEP_KEY)
        return (
            {}
            if stored is None
            else Session._core_map(core_rules().session_kept_of(stored))
        )

    @staticmethod
    def _core_map(value: object) -> dict:
        """Returns a copy of a map that the core gave."""
        return dict(value) if isinstance(value, dict) else {}
