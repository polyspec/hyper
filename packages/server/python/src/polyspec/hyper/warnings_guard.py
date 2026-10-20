"""Turns the warnings of the Python runtime into errors while a request is answered (HY-74)."""

from __future__ import annotations

import contextlib
import threading
import warnings
from collections.abc import Iterator

_LOCK = threading.Lock()
_ACTIVE = 0
_SAVED: warnings.catch_warnings | None = None


@contextlib.contextmanager
def warnings_as_errors() -> Iterator[None]:
    """Sets the warnings filter `error` for as long as a request is in flight and restores the previous filters when the
    last one ends. Requests of several threads share the one setting, so the filters are restored once, by the last."""
    global _ACTIVE, _SAVED
    with _LOCK:
        if _ACTIVE == 0:
            _SAVED = warnings.catch_warnings()
            _SAVED.__enter__()
            warnings.simplefilter("error")
        _ACTIVE += 1
    try:
        yield
    finally:
        with _LOCK:
            _ACTIVE -= 1
            if _ACTIVE == 0 and _SAVED is not None:
                _SAVED.__exit__(None, None, None)
                _SAVED = None
