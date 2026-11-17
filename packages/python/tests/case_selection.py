# The selection of cases of the case runner (H35.9-11): the names of RECIPE_CASES, which white space separates. A name
# `<file>#<section>` names the cases of a section, a name that ends with `.json` the cases of a file, and any other
# name the cases of that id in every file.
from __future__ import annotations

from collections.abc import Callable
from typing import TypeVar

from .case_rules import LANGUAGE

Case = TypeVar("Case")


def names(selection: str) -> list[str]:
    """The names of a selection."""
    return selection.split()


def _is_named(name: str, case: tuple[str, str, str]) -> bool:
    file, section, identity = case
    if "#" in name:
        return name == f"{file}#{section}"
    return name == file if name.endswith(".json") else name == identity


def select(
    selection: str,
    cases: list[Case],
    name_of: Callable[[Case], tuple[str, str, str]],
) -> list[Case]:
    """The cases that a selection names, in the order of the runner.

    A selection without a name and a name that names no case of the runner raise ValueError, with the selection and
    each such name (HR-84). `name_of` gives the file, the section and the id of a case.
    """
    wanted = names(selection)
    if not wanted:
        raise ValueError(
            f'the selection "{selection}" of the {LANGUAGE} runner names no case'
        )
    selected = []
    matched: set[str] = set()
    for case in cases:
        named = [name for name in wanted if _is_named(name, name_of(case))]
        if named:
            selected.append(case)
            matched.update(named)
    unmatched = [name for name in wanted if name not in matched]
    if unmatched:
        raise ValueError(
            f'the selection "{selection}" of the {LANGUAGE} runner selects no case for '
            + ", ".join(unmatched)
        )
    return selected
