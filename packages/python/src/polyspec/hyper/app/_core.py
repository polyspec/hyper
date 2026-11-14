"""The rules of the core that the units of the server call (HY-132.2). `core` gives `CoreRules` over the module of the
Python binding of the core, `polyspec.hyper._binding._root`, which it imports at its first call, so that importing the
package reads no native module. A package without the native module fails at the first rule that a unit calls, and no
unit of the server states a rule of its own in its place."""

from __future__ import annotations

import functools

from ._core_rules import CoreRules


@functools.cache
def core() -> CoreRules:
    """Returns the rules of the core. The first call imports the module of the binding, which imports the native module;
    in a checkout `make hyper-install-python` builds it into the venv of the package."""
    from .._binding import _root

    return CoreRules(_root)
