# The media type that the application selects for a request from its Accept header (HY-116), the 400 and the 406 that
# refuse it, and the media type of the JSON responses (HY-15, HY-17, HY-62 steps 2 and 3).
import unittest

from .render_app import get, opened
from .render_client import Counter, app, conformance
from polyspec.hyper.request import Request
from polyspec.hyper.session import ArraySession

JSON = "application/vnd.hyper+json"
PAGE_LIST = "text/html\napplication/vnd.hyper+json\n"


class AcceptTest(unittest.TestCase):
    def test_an_invalid_accept_is_a_bad_request_with_vary(self) -> None:
        response = opened().handle(get("/", {"Accept": "text/html;q=x"}), ArraySession())
        self.assertEqual(400, response.status)
        self.assertEqual("Bad Request", response.body)
        self.assertEqual("text/plain; charset=utf-8", response.headers["Content-Type"])
        self.assertEqual("Accept", response.headers["Vary"])

    def test_a_request_that_matches_no_type_lists_the_served_types(self) -> None:
        for accept in ["application/json", ""]:
            with self.subTest(accept=accept):
                response = opened().handle(get("/", {"Accept": accept}), ArraySession())
                self.assertEqual(406, response.status)
                self.assertEqual(PAGE_LIST, response.body)
                self.assertEqual(
                    "text/plain; charset=utf-8", response.headers["Content-Type"]
                )
                self.assertEqual("Accept", response.headers["Vary"])
                self.assertNotIn("ETag", response.headers)

    def test_a_json_response_has_the_media_type_without_a_charset(self) -> None:
        response = opened().handle(get("/", {"Accept": JSON}), ArraySession())
        self.assertEqual(200, response.status)
        self.assertEqual(JSON, response.headers["Content-Type"])
        self.assertEqual(
            "Accept, HX-Request, HX-Current-URL", response.headers["Vary"]
        )

    def test_an_unrouted_path_is_not_found_before_the_selection(self) -> None:
        response = opened().handle(
            get("/no-such-page", {"Accept": "text/html;q=x"}), ArraySession()
        )
        self.assertEqual(404, response.status)
        self.assertEqual("Not Found", response.body)

    def test_the_data_path_serves_only_the_json_type(self) -> None:
        # HY-62 step 2: a request that selects text/html receives 406 Not Acceptable, and a request that matches
        # none of the served types lists the JSON type alone.
        base = conformance()["basePath"]
        host = conformance()["chosenHost"]
        application = app(Counter())
        page = application.handle(
            Request("GET", base + "/items/7", {"Host": host, "Accept": "text/html"}),
            ArraySession(),
        )
        self.assertEqual(406, page.status)
        self.assertEqual("Not Acceptable", page.body)
        self.assertEqual("Accept", page.headers["Vary"])
        none = application.handle(
            Request("GET", base + "/items/7", {"Host": host, "Accept": "image/png"}),
            ArraySession(),
        )
        self.assertEqual(406, none.status)
        self.assertEqual(f"{JSON}\n", none.body)
        served = application.handle(
            Request("GET", base + "/items/7", {"Host": host, "Accept": JSON}),
            ArraySession(),
        )
        self.assertEqual(200, served.status)
        self.assertEqual(JSON, served.headers["Content-Type"])

    def test_the_shell_serves_only_the_page_type(self) -> None:
        # HY-62 step 3: a request that selects the JSON type receives 406 Not Acceptable, and a request that selects
        # text/html receives the shell with the Vary of HY-117.
        host = conformance()["chosenHost"]
        application = app(Counter())
        data = application.handle(
            Request("GET", "/items/7", {"Host": host, "Accept": JSON}), ArraySession()
        )
        self.assertEqual(406, data.status)
        self.assertEqual("Not Acceptable", data.body)
        self.assertEqual("Accept", data.headers["Vary"])
        shell = application.handle(
            Request("GET", "/items/7", {"Host": host, "Accept": "*/*"}), ArraySession()
        )
        self.assertEqual(200, shell.status)
        self.assertEqual("text/html; charset=utf-8", shell.headers["Content-Type"])
        self.assertEqual(
            "Accept, HX-Request, HX-Current-URL", shell.headers["Vary"]
        )


if __name__ == "__main__":
    unittest.main()
