"""The rule of the `Vary` of a response (HY-117.1) as the Python server stated it before `App._vary_header` of
polyspec/hyper/app/app.py called the core (H31.8-1)."""

from __future__ import annotations


def vary_header(context: bool) -> str:
    """Returns the `Vary` of a response that `Accept` and the context decide (HY-117)."""
    if not context:
        return "Accept, HX-Request, HX-Current-URL"
    return "Accept, HX-Request, HX-Current-URL, Hyper-Context"
