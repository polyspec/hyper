"""One declared representation of a route (HY-118)."""

from __future__ import annotations


class RepresentationEntry:
    """One declared representation of a route (HY-118): its type as the manifest writes it, its lower-case media type,
    its required parameters with their served values in declared order, its methods and its vary names."""

    type: str
    media: str
    parameters: tuple[tuple[str, tuple[str, ...]], ...]
    methods: tuple[str, ...]
    vary: tuple[str, ...]

    def __init__(
        self,
        type: str,
        media: str,
        parameters: tuple[tuple[str, tuple[str, ...]], ...],
        methods: tuple[str, ...],
        vary: tuple[str, ...],
    ) -> None:
        self.type = type
        self.media = media
        self.parameters = parameters
        self.methods = methods
        self.vary = vary
