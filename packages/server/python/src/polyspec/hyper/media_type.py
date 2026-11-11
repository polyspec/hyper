"""The media type of a representation request that the server selected, as a representation handler receives it
(HY-106, HY-119): the values of the parameters that the entry requires, in the order of the manifest."""

from __future__ import annotations


class MediaType:
    """The selected media type of a representation request."""

    def __init__(self, parameters: dict[str, str]):
        self._parameters = dict(parameters)

    def parameters(self) -> dict[str, str]:
        """Returns the served value of each required parameter, by its lower-case name, in declared order (HY-119)."""
        return dict(self._parameters)
