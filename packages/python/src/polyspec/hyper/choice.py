"""The result of the selection of a client rendering (HY-62)."""

from __future__ import annotations


class Choice:
    """The result of the selection of a client rendering (HY-62): whether the request is of a client-rendered page,
    and a value that every loader and action of the request reads with `Request.selection`."""

    chosen: bool
    value: object

    def __init__(self, chosen: bool, value: object) -> None:
        self.chosen = chosen
        self.value = value
