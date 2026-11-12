"""The client-rendered pages of an application (HY-62): the static shell that answers their HTML requests, the base
path of their JSON requests and actions, and the selection that chooses their requests."""

from __future__ import annotations

from typing import Callable

from .choice import Choice
from .request import Request


class ClientRendering:
    """Declares the client-rendered pages of an application (HY-62): `shell` is the absolute path of the static shell,
    which declares the base path with `<meta name="hyper-api">` (HYC-8); `base_path` is the data base path, such as
    `/_props` (HY-8); and `selects` returns a Choice for a request, whose value every loader and action of the request
    reads with `Request.selection()`; another value fails the request with HY-43."""

    shell: str
    base_path: str
    selects: Callable[[Request], Choice]

    def __init__(
        self, shell: str, base_path: str, selects: Callable[[Request], Choice]
    ) -> None:
        self.shell = shell
        self.base_path = base_path
        self.selects = selects
