# The media type of the JSON responses (HY-15, HY-17). The cases of contracts/representations.json and
# contracts/client.json state the selection of a media type from the Accept header (HY-116) and its refusals.
import unittest

from .render_app import get, opened
from polyspec.hyper.array_session import ArraySession

JSON = "application/vnd.hyper+json"


class AcceptTest(unittest.TestCase):
    def test_a_json_response_has_the_media_type_without_a_charset(self) -> None:
        response = opened().handle(get("/", {"Accept": JSON}), ArraySession())
        self.assertEqual(200, response.status)
        self.assertEqual(JSON, response.headers["Content-Type"])
        self.assertEqual("Accept, HX-Request, HX-Current-URL", response.headers["Vary"])


if __name__ == "__main__":
    unittest.main()
