# The steps of contracts/reads.json (HY-73): the data that a template keeps, by the reads that the case states, and the
# render of the template with the kept data and with the data, which gives the same bytes (HY-73.28). Each case is the
# application `reads_<id>` that scripts/contract-programs.mjs builds from the templates of the case.
from pathlib import Path

from polyspec.hyper._reads import Reads
from polyspec.hyper._renderer import Renderer

PROGRAMS = Path(__file__).resolve().parents[5] / "var" / "contract-programs"


def cases(case) -> None:
    data = case.input("data")
    kept = Reads.keep(data, case.input("reads"))
    case.compare("kept", kept)

    templates = case.input("templates")
    template = case.input("template")
    if template not in templates:
        raise ValueError(f"the template {template} is not among the templates of {case.id()}")
    program = PROGRAMS / f"reads_{case.id()}" / "program"
    renderer = Renderer.open(str(program), "Z")
    shared = renderer.bind({})
    case.outcome(
        "render",
        [
            renderer.alone(template, shared, renderer.bind(kept)),
            renderer.alone(template, shared, renderer.bind(data)),
        ],
    )
