from . import widget
from .widget import Widget as Made
import tools.widget as made


class Widget:
    pass


def make():
    return Made(), widget.Widget(), made.Widget(), Widget()
