"""The receivers of the scope reading (HYR-5): what the source writes about the class of each."""

from collections.abc import Sequence
from typing import Generic, Optional, TypeVar

from .widget import Widget


def widget() -> None:
    """A function of the module whose name a parameter of a method also has."""


def either() -> None:
    """A function of the module whose name a variable of a method also has."""


class Receivers:
    kept: Optional[Widget]

    def made(self) -> "Optional[Widget]":
        return self.kept

    def listed(self, widgets: Sequence[Widget], others: list[Widget]) -> None:
        for listed_widget in widgets:
            listed_widget.grow()
        for other in others:
            other.grow()

    def run(self, widget: Widget, text: str) -> None:
        widget.grow()
        Widget.make()
        self.other()
        made = Widget()
        self.kept = made
        text.encode("utf-8")
        for item in self.all():
            item.size
        either = widget or Widget()
        either.grow()


T = TypeVar("T")


class Listed(Generic[T]):
    """A generic class that a class extends with an argument."""


class Widgets(Listed[Widget]):
    """A class that extends a generic class."""
