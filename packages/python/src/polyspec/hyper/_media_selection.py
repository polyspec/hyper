"""The selection of the media type of a request among the page types and the representations of its route (HY-116,
HY-119), the list of the types that a path serves, and the `Content-Type` of a representation."""

from __future__ import annotations

import itertools
import re
from collections.abc import Sequence
from typing import Optional

from ._accept import Accept
from ._media_range import MediaRange
from ._representation_entry import RepresentationEntry

_TOKEN = re.compile(r"[!#$%&'*+\-.^_`|~0-9A-Za-z]+")


class MediaSelection:
    """The selection of the media type of a request (HY-116, HY-119)."""

    @staticmethod
    def select(
        accept: Optional[str],
        pages: Sequence[str],
        entries: Sequence[RepresentationEntry],
    ) -> Optional[tuple[str, Optional[RepresentationEntry], dict[str, str]]]:
        """Returns the type of the highest weight among the page types and the entries, with its entry and the values of
        its required parameters for a representation, or None when no type has a weight above 0. Among equal weights the
        first wins: the page types in their order, then the entries in declared order (HY-116.11). Raises InvalidAccept
        as `Accept.parse` does."""
        ranges = Accept.parse(accept)
        page, best = Accept.best(ranges, pages)
        selected: Optional[
            tuple[str, Optional[RepresentationEntry], dict[str, str]]
        ] = None if page is None else (page, None, {})
        for entry in entries:
            weight, values = MediaSelection.entry_weight(ranges, entry)
            if weight > best:
                selected, best = (entry.media, entry, values), weight
        return selected

    @staticmethod
    def entry_weight(
        ranges: Sequence[MediaRange], entry: RepresentationEntry
    ) -> tuple[int, dict[str, str]]:
        """Returns the weight in thousandths that the ranges give a declared type, and the parameter values of the range
        that gives it: the highest weight, and the first in `Accept` order among equal ones, of the ranges that name the
        type with a served value for every required parameter and no other parameter (HY-116.8, HY-119)."""
        name, _, subtype = entry.media.partition("/")
        required = {parameter.lower(): served for parameter, served in entry.parameters}
        weight = 0
        values: dict[str, str] = {}
        for item in ranges:
            if item.type != name or item.subtype != subtype:
                continue
            given = dict(item.parameters)
            if len(item.parameters) != len(required) or given.keys() != required.keys():
                continue
            if any(
                given[parameter] not in served for parameter, served in required.items()
            ):
                continue
            if item.weight > weight:
                weight = item.weight
                values = {parameter: given[parameter] for parameter in required}
        return weight, values

    @staticmethod
    def content_type(entry: RepresentationEntry, values: dict[str, str]) -> str:
        """Returns the `Content-Type` of a representation: its type and, for each required parameter in declared order,
        `; <name>=<value>` with the name in lower case and the value quoted when it is no token (HY-119.4)."""
        written = entry.type
        for parameter, _ in entry.parameters:
            value = values[parameter.lower()]
            if _TOKEN.fullmatch(value) is None:
                value = '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'
            written += f"; {parameter.lower()}={value}"
        return written

    @staticmethod
    def listing(pages: Sequence[str], entries: Sequence[RepresentationEntry]) -> str:
        """Returns the types that a path serves, each on a line that ends with a line feed: the page types, then each
        entry once for each combination of one served value of every required parameter, ordered by the values of the
        first parameter, then of the next (HY-116.13)."""
        lines = list(pages)
        for entry in entries:
            names = [parameter.lower() for parameter, _ in entry.parameters]
            for combination in itertools.product(
                *(served for _, served in entry.parameters)
            ):
                lines.append(
                    MediaSelection.content_type(entry, dict(zip(names, combination)))
                )
        return "".join(f"{line}\n" for line in lines)
