# The build id is a member of every JSON response, right after `params` (HY-128, HY-17).
import unittest

from .render_app import get, opened
from polyspec.hyper.session import ArraySession

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


if __name__ == "__main__":
    unittest.main()
