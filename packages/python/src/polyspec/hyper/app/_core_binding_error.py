"""The error of a binding of the core that does not import (HY-133.2)."""


class CoreBindingError(ImportError):
    """The binding of the core does not import. The server has no rule of its own in place of the core, so the first
    unit that needs a rule fails with this error, which names the module (HY-133.2)."""
