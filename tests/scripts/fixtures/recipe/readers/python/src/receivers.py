"""The receivers of the scope reading (HYR-5): what the source writes about the class of each."""

from typing import Optional

from .widget import Widget


class Receivers:
    kept: Optional[Widget]

    def made(self) -> "Optional[Widget]":
        return self.kept

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
