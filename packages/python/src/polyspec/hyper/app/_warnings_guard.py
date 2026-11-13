"""Turns the warnings of the Python runtime into errors while a request is answered (HY-74)."""

from __future__ import annotations

import threading
import warnings
from typing import Callable, TypeVar

T = TypeVar("T")

_LOCK = threading.Lock()
_ACTIVE = 0
_SAVED: warnings.catch_warnings | None = None


class WarningsGuard:
    @staticmethod
    def run(work: Callable[[], T]) -> T:
        """Runs `work` with the warnings filter `error`, which is set for as long as a request is in flight and
        restored to the previous filters when the last one ends. Requests of several threads share the one setting,
        so the filters are restored once, by the last."""
        global _ACTIVE, _SAVED
        with _LOCK:
            if _ACTIVE == 0:
                _SAVED = warnings.catch_warnings()
                _SAVED.__enter__()
                warnings.simplefilter("error")
            _ACTIVE += 1
        try:
            return work()
        finally:
            with _LOCK:
                _ACTIVE -= 1
                if _ACTIVE == 0 and _SAVED is not None:
                    _SAVED.__exit__(None, None, None)
                    _SAVED = None
