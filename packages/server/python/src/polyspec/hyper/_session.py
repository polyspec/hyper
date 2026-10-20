"""The session of one browser session over a store: the CSRF token, the flash values and the kept values (HY-24, HY-25,
HY-40)."""

from __future__ import annotations

import re
import secrets

from .session import SessionStore

_TOKEN = re.compile(r"[0-9a-f]{64}\Z")
_TOKEN_KEY = "_hyper_csrf"
_FLASH_KEY = "_hyper_flash"
_KEEP_KEY = "_hyper_keep"


class Flash:
    """Values and changed topics that an action passes to the next request (HY-17, HY-25)."""

    def __init__(self, values: dict, changed: list[str]):
        self.values = values
        self.changed = changed


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
        """Returns the stored flash data and removes it from the session."""
        flash = self._store.get(_FLASH_KEY)
        self._store.remove(_FLASH_KEY)
        if not isinstance(flash, dict):
            return Flash({}, [])
        values = flash.get("values", {})
        changed = flash.get("changed", [])
        if not isinstance(values, dict) or not isinstance(changed, list):
            raise ValueError(
                "the session holds flash data that is not values and a list of topics"
            )
        for topic in changed:
            if not isinstance(topic, str):
                raise ValueError(
                    "the session holds a changed topic that is not a string"
                )
        return Flash(dict(values), list(changed))

    def put_flash(self, flash: Flash) -> None:
        """Stores flash data for the next request."""
        self._store.set(_FLASH_KEY, {"values": flash.values, "changed": flash.changed})

    def keep(self, region: str, path: str, value: object) -> None:
        """Stores a kept value of a region (HY-38, HY-40)."""
        stored = self._store.get(_KEEP_KEY)
        kept = stored if isinstance(stored, dict) else {}
        region_kept = kept.get(region)
        kept[region] = dict(region_kept if isinstance(region_kept, dict) else {})
        kept[region][path] = value
        self._store.set(_KEEP_KEY, kept)

    def kept(self, region: str) -> dict:
        """Returns the kept values of a region by path in storing order."""
        stored = self._store.get(_KEEP_KEY)
        kept = stored.get(region) if isinstance(stored, dict) else None
        return dict(kept) if isinstance(kept, dict) else {}
