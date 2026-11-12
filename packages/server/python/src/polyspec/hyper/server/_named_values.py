"""The names of a request part in the order of their first occurrence and the values of each name in request order,
which Fields and Files hold (HY-56, HY-57, HY-113)."""

from __future__ import annotations

from typing import Generic, Optional, TypeVar

T = TypeVar("T")


class NamedValues(Generic[T]):
    """An ordered map from each name to its values in request order."""

    def __init__(self, names: list[str], values: dict[str, list[T]]):
        self.__names = names
        self.__values = values

    def names(self) -> list[str]:
        """Returns the names in the order of their first occurrence."""
        return list(self.__names)

    def get(self, name: str) -> list[T]:
        """Returns the values of a name in request order; an absent name has none."""
        return list(self.__values.get(name, []))

    def last(self, name: str) -> Optional[T]:
        """Returns the last value of a name, or None."""
        values = self.__values.get(name)
        return values[-1] if values else None

    def pairs(self) -> list[tuple[str, list[T]]]:
        """Returns each name with its values, in the order of the names (HY-56.4)."""
        return [(name, self.get(name)) for name in self.__names]
