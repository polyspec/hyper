"""The representations of a route: the declaration of each entry and its manifest check (HY-2, HY-118), and the
check of the representation handlers that an application provides at open (HY-118)."""

from __future__ import annotations

import re

from ._representation_entry import RepresentationEntry

_TOKEN = re.compile(r"[!#$%&'*+\-.^_`|~0-9A-Za-z]+")
# The characters that a served value may hold: HTAB, SP and U+0021 to U+007E (HY-118.6), which are valid in a quoted
# string (RFC 9110, section 5.6.4) and have the same bytes in UTF-8 and ISO-8859-1.
_QUOTABLE = re.compile(r"[\t \x21-\x7e]+")
_METHODS = ("GET", "POST", "PUT", "DELETE")
_PAGE_TYPES = ("text/html", "application/vnd.hyper+json")
_REJECTED_VARY = ("accept", "cookie")


class RepresentationEntries:
    """The declaration of the representations of a route and the check of their handlers (HY-118)."""

    @staticmethod
    def declare(route: str, raw: list[dict]) -> list[RepresentationEntry]:
        """Returns the entries of a route in the order of the manifest, checked by HY-2 and HY-118: a duplicate type, a
        page type, a wildcard, an invalid type, parameter or value, an empty method or value list, and an invalid vary
        name fail the manifest."""
        entries: list[RepresentationEntry] = []
        media_types: set[str] = set()
        for item in raw:
            entry = RepresentationEntries._entry(route, item)
            if entry.media in media_types:
                raise ValueError(
                    f"route {route} declares the type {entry.type} twice (HY-118)"
                )
            media_types.add(entry.media)
            entries.append(entry)
        return entries

    @staticmethod
    def check_handlers(
        route: str, entries: list[RepresentationEntry], handlers: dict
    ) -> None:
        """Fails the open when an entry has no handler or a handler is keyed by a type that the route does not declare;
        the keys compare exactly as the manifest writes them (HY-118)."""
        declared = [entry.type for entry in entries]
        for entry_type in declared:
            if entry_type not in handlers:
                raise ValueError(
                    f"route {route} has no representation handler for {entry_type} (HY-118)"
                )
        for entry_type in handlers:
            if entry_type not in declared:
                raise ValueError(
                    f"route {route} has a representation handler for {entry_type}, which the route does not declare (HY-118)"
                )

    @staticmethod
    def _entry(route: str, item: dict) -> RepresentationEntry:
        for key in ("type", "parameters", "methods", "vary"):
            if key not in item:
                raise ValueError(
                    f"route {route} has a representation without {key} (HY-118)"
                )
        kind = item["type"]
        if not isinstance(kind, str):
            raise ValueError(
                f"route {route} has a representation type that is not text (HY-118)"
            )
        # The type and the subtype are tokens as the manifest writes them, so that lower case changes only ASCII letters.
        main, slash, sub = kind.partition("/")
        media = kind.lower()
        if (
            not slash
            or _TOKEN.fullmatch(main) is None
            or _TOKEN.fullmatch(sub) is None
            or "*" in (main, sub)
            or media in _PAGE_TYPES
        ):
            raise ValueError(
                f"route {route} has the invalid representation type {kind} (HY-118)"
            )
        return RepresentationEntry(
            type=kind,
            media=media,
            parameters=RepresentationEntries._served_parameters(
                route, kind, item["parameters"]
            ),
            methods=RepresentationEntries._answered_methods(
                route, kind, item["methods"]
            ),
            vary=RepresentationEntries._vary_names(route, kind, item["vary"]),
        )

    @staticmethod
    def _served_parameters(
        route: str, kind: str, raw: object
    ) -> tuple[tuple[str, tuple[str, ...]], ...]:
        if not isinstance(raw, dict):
            raise ValueError(
                f"route {route} has parameters of {kind} that are not an object (HY-118)"
            )
        parameters: list[tuple[str, tuple[str, ...]]] = []
        names: set[str] = set()
        for name, values in raw.items():
            lower = name.lower()
            if _TOKEN.fullmatch(name) is None or lower == "q" or lower in names:
                raise ValueError(
                    f"route {route} has the invalid parameter {name} of {kind} (HY-118)"
                )
            names.add(lower)
            if not isinstance(values, list) or values == []:
                raise ValueError(
                    f"route {route} has no served value for {name} of {kind} (HY-118)"
                )
            served: list[str] = []
            for value in values:
                if not isinstance(value, str) or (
                    _TOKEN.fullmatch(value) is None
                    and _QUOTABLE.fullmatch(value) is None
                ):
                    raise ValueError(
                        f"route {route} has the invalid value of {name} of {kind} (HY-118)"
                    )
                served.append(value)
            parameters.append((lower, tuple(served)))
        return tuple(parameters)

    @staticmethod
    def _answered_methods(route: str, kind: str, raw: object) -> tuple[str, ...]:
        if (
            not isinstance(raw, list)
            or raw == []
            or any(m not in _METHODS for m in raw)
        ):
            raise ValueError(
                f"route {route} has methods of {kind} that are not a nonempty subset of GET, POST, PUT, DELETE (HY-118)"
            )
        return tuple(raw)

    @staticmethod
    def _vary_names(route: str, kind: str, raw: object) -> tuple[str, ...]:
        if not isinstance(raw, list):
            raise ValueError(
                f"route {route} has vary names of {kind} that are not a list (HY-118)"
            )
        names: list[str] = []
        for name in raw:
            if not isinstance(name, str) or _TOKEN.fullmatch(name) is None:
                raise ValueError(
                    f"route {route} has the vary name {name} of {kind} that is not a field name (HY-118)"
                )
            if name.lower() in _REJECTED_VARY or name.lower() in (
                n.lower() for n in names
            ):
                raise ValueError(
                    f"route {route} has the vary name {name} of {kind} that is rejected or repeated (HY-118)"
                )
            names.append(name)
        return tuple(names)
