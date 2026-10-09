"""The client-rendered pages of an application (HY-62): the static shell that answers their HTML requests, the base
path of their JSON requests and actions, and the selection that chooses their requests."""

from __future__ import annotations

from .request import Request


class Choice:
    """The result of the selection of a client rendering (HY-62): whether the request is of a client-rendered page,
    and a value that every loader and action of the request reads with `Request.selection`."""

    def __init__(self, chosen: bool, value: object):
        self.chosen = chosen
        self.value = value


class ClientRendering:
    """Declares the client-rendered pages of an application (HY-62)."""

    def __init__(self, shell: str, base_path: str, selects: 'callable[[Request], Choice]'):
        self.shell = shell
        """The absolute path of the static shell, which declares the base path with `<meta name="hyper-api">`
        (HY-22)."""
        self.base_path = base_path
        """The data base path, such as `/_props` (HY-8)."""
        self.selects = selects
        """Returns a Choice for a request: whether the request is of a client-rendered page, and the value that
        every loader and action of the request reads with `Request.selection()`; another value fails the request
        with HY-43."""
