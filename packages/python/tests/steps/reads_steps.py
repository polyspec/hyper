# The steps of contracts/reads.json (HY-73): the data that a template keeps, by the reads that the case states, and the
# render of the template with the kept data and with the data, which gives the same bytes (HY-73.28). Each case is the
# application `reads_<id>` that scripts/contract-programs.mts builds from the templates of the case. The pages of the
# core keep the read paths and render, as the server does: the kept data is the data of the page region in the JSON
# response of the route `reads`, and each text is the page region rendered alone.
import json
from pathlib import Path

from polyspec.hyper._binding import _root as core
from polyspec.hyper.app.app import App

from .recorded import decoded

PROGRAMS = Path(__file__).resolve().parents[4] / "var" / "contract-programs"
_OPTIONS = {
    "timezone": "Z",
    "context": False,
    "base_path": "",
    "form_types": ["application/x-www-form-urlencoded"],
    "data_base_path": None,
}


def cases(case) -> None:
    templates = case.input("templates")
    template = case.input("template")
    if template not in templates:
        raise ValueError(
            f"the template {template} is not among the templates of {case.id()}"
        )
    root = PROGRAMS / f"reads_{case.id()}"
    program = root / "program"
    pages = App._open_pages(
        (root / "manifest.json").read_bytes(), str(program), None, _OPTIONS
    )
    data = case.input("data")
    # The read paths of the case, which the build wrote to reads.json and the pages keep; the comparison below
    # checks them against reads.json.
    case.input("reads")
    kept = _kept(pages, data)
    case.compare("kept", kept)
    # HY-73.34: the build wrote the read paths of the template of the case, the page region of the route `reads` of
    # the application, to reads.json of the program that the pages open.
    built = json.loads((program / "reads.json").read_text(encoding="utf-8"))
    case.compare("reads", built["routes"]["reads"]["regions"]["content"])
    text = _alone(pages, data)
    case.outcome("render", [_alone(pages, kept), text])
    case.compare("text", text)


def _kept(pages, data: dict) -> object:
    """The data of the page region that the JSON response of the route `reads` holds, the loader data kept by the read
    paths of the route."""
    page = core.PageRequest(
        pages,
        route="reads",
        params={},
        kind=core.PageKind.DOCUMENT_JSON,
        action=False,
        csrf="",
        changed=[],
        now=0.0,
    )
    step = page.next(core.PageStepInputStart())
    while isinstance(step, core.StepCall):
        call = step.call
        if isinstance(call, core.CallRouteLoader):
            given = core.PageStepInputLoaded(data=data)
        elif isinstance(call, core.CallReply):
            given = core.PageStepInputReply(embeds=False, stored={})
        else:
            given = core.PageStepInputNoHandler()
        step = page.next(given)
    if not isinstance(step.answer, core.AnswerJson):
        raise TypeError("the route reads answered no JSON")
    return decoded(step.answer.text)["regions"]["content"]


def _alone(pages, data: dict) -> str:
    """The page region of the route `reads` rendered alone with the data."""
    return pages.render_parts("reads", {}, {"content": data}, 0.0).regions["content"]
