# The build id is a member of every JSON response, right after `params` (HY-128, HY-17).
import json
import tempfile
import unittest
from pathlib import Path

from .render_app import get, opened
from polyspec.hyper._renderer import Renderer
from polyspec.hyper.array_session import ArraySession

JSON = "application/vnd.hyper+json"
ONES = "1" * 64


class BuildMemberTest(unittest.TestCase):
    def test_a_document_json_holds_the_build_after_params(self) -> None:
        response = opened().handle(get("/", {"Accept": JSON}), ArraySession())
        self.assertEqual(200, response.status)
        self.assertTrue(
            response.body.startswith(
                '{"env":{"timezone":"+09:00"},"route":"home","params":{},"build":"'
                + ONES
                + '","shared":'
            ),
            response.body[:200],
        )

    def test_a_region_json_holds_the_build_after_params(self) -> None:
        response = opened().handle(
            get("/", {"Accept": JSON, "HX-Request": "true"}), ArraySession()
        )
        self.assertEqual(200, response.status)
        self.assertTrue(
            response.body.startswith(
                '{"env":{"timezone":"+09:00"},"route":"home","params":{},"build":"'
                + ONES
                + '","shared":'
            ),
            response.body[:200],
        )


class BuildElementTest(unittest.TestCase):
    def test_a_layout_that_places_the_build_renders_the_build_element_once(self) -> None:
        # HY-125: the html definition `build` is the meta element of the build id, which the layout places with
        # `{# build}` inside `<head>`.
        with tempfile.TemporaryDirectory() as directory:
            program = Path(directory)
            (program / "templates").mkdir()
            (program / "templates" / "layout.tpl").write_text(
                "<head>{# build}</head>", encoding="utf-8"
            )
            (program / "templates" / "title.tpl").write_text("Title", encoding="utf-8")
            (program / "reads.json").write_text("{}", encoding="utf-8")
            (program / "build.json").write_text(json.dumps({"build": ONES}), encoding="utf-8")
            renderer = Renderer.open(str(program), "+09:00")
            html = renderer.document(
                "layout.tpl", "title.tpl", renderer.bind({}), {}, "content", {}, None, ONES
            )
        self.assertEqual(
            '<head><meta name="hyper-build" content="' + ONES + '"></head>', html
        )


if __name__ == "__main__":
    unittest.main()
