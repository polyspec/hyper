# The request target, the query values, the stops and results, the reply, the session values and the manifest (HY-15,
# HY-24, HY-25, HY-40, HY-42, HY-46, HY-50 to HY-52, HY-56 to HY-58, HY-62, HY-69, HY-72, HY-92, HY-103).
import unittest
from pathlib import Path

from polyspec.hyper.request import Request
from polyspec.hyper._session import Flash, Session
from polyspec.hyper.session import ArraySession

FIXTURES = Path(__file__).resolve().parents[2] / "php" / "tests" / "fixtures"


class TargetTest(unittest.TestCase):
    def test_the_path_of_a_target_skips_the_query_and_the_fragment(self) -> None:
        self.assertEqual("/board/7", Request.target_path("/board/7?a=b#c"))
        self.assertEqual("/board/7", Request.target_path("/board/7"))
        self.assertEqual("/", Request.target_path("?a=b"))
        self.assertEqual("/", Request.target_path(""))

    def test_the_path_of_an_absolute_form_target_skips_the_authority(self) -> None:
        self.assertEqual("/board", Request.target_path("http://host.example/board"))
        self.assertEqual("/", Request.target_path("http://host.example"))

    def test_the_raw_query_stops_at_a_fragment(self) -> None:
        self.assertEqual("a=b&c=d", Request.target_query("/x?a=b&c=d#f"))
        self.assertEqual("", Request.target_query("/x#f"))
        self.assertEqual("", Request.target_query("/x"))


class RequestValuesTest(unittest.TestCase):
    def test_query_values_without_nesting(self) -> None:
        request = Request("GET", "/x", {}, "z=1&y=2&x=3&y=4")
        self.assertEqual(["z", "y", "x"], request.query().names())
        self.assertEqual(["2", "4"], request.query().get("y"))
        self.assertEqual(4, request.query_int("y", 0))
        self.assertEqual(7, request.query_int("missing", 7))

    def test_a_query_that_is_not_utf8_is_invalid_input(self) -> None:
        self.assertEqual([], Request("GET", "/x", {}, "a=%ff").query().names())
        self.assertFalse(Request("GET", "/x", {}, "a=%ff").valid_input())
        self.assertTrue(Request("GET", "/x", {}, "a=%c3%a9").valid_input())

    def test_a_path_outside_printable_ascii_is_invalid_input(self) -> None:
        self.assertFalse(Request("GET", "/a b").valid_input())
        self.assertTrue(Request("GET", "/a%20b").valid_input())

    def test_the_body_size_counts_the_declared_length(self) -> None:
        self.assertEqual(
            5, Request("POST", "/x", {"Content-Length": "5"}, body=b"123").body_size()
        )
        self.assertEqual(3, Request("POST", "/x", {}, body=b"123").body_size())
        self.assertEqual(
            3, Request("POST", "/x", {"Content-Length": "x"}, body=b"123").body_size()
        )

    def test_a_region_request_wants_json_with_the_hx_request_header(self) -> None:
        # HY-15, HY-116: the kind reads the selected media type that the server holds, not the Accept header.
        json_type = "application/vnd.hyper+json"
        self.assertTrue(
            Request("GET", "/x", {"HX-Request": "true"})
            ._with_media(json_type)
            .is_region_request()
        )
        self.assertFalse(
            Request("GET", "/x", {})._with_media(json_type).is_region_request()
        )
        self.assertFalse(
            Request("GET", "/x", {"HX-Request": "true"})
            ._with_media("text/html")
            .is_region_request()
        )

    def test_the_kind_of_a_request_without_a_selected_type_fails(self) -> None:
        # HY-116: a request that the server did not select has no kind, and its Accept header is not read.
        with self.assertRaises(RuntimeError):
            Request("GET", "/x", {"Accept": "application/vnd.hyper+json"}).wants_json()

    def test_the_current_path_of_a_header_url(self) -> None:
        self.assertEqual(
            "/list",
            Request(
                "GET", "/x", {"HX-Current-URL": "http://host.example/list?a=b"}
            ).current_path(),
        )
        self.assertIsNone(Request("GET", "/x").current_path())

    def test_a_copy_with_a_header_sets_the_header_by_its_name_without_case(
        self,
    ) -> None:
        # HY-97: the request hook of the server adds a header to the request that it gives to the application.
        request = Request(
            "POST",
            "/x",
            {
                "Accept": "text/html",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            "a=1",
            b"name=n",
            cookies={"c": "v"},
            https=True,
        )._with_selection("s")
        copy = request.with_header("accept", "application/json").with_header(
            "X-Request-Id", "r1"
        )
        self.assertEqual("application/json", copy.header("Accept"))
        self.assertEqual("r1", copy.header("x-request-id"))
        self.assertEqual("text/html", request.header("Accept"))
        self.assertIsNone(request.header("X-Request-Id"))
        self.assertEqual(
            ("POST", "/x", "a=1", "n", "v", True, "s"),
            (
                copy.method,
                copy.path(),
                copy.raw_query(),
                copy.form_string("name"),
                copy.cookie("c"),
                copy.https,
                copy.selection(),
            ),
        )

    def test_the_selection_of_a_request(self) -> None:
        request = Request("GET", "/x")._with_selection({"host": "a.test"})
        self.assertEqual({"host": "a.test"}, request.selection())
        self.assertIsNone(Request("GET", "/x").selection())


class SessionTest(unittest.TestCase):
    def test_the_csrf_token_is_created_once(self) -> None:
        session = Session(ArraySession())
        token = session.csrf_token()
        self.assertEqual(64, len(token))
        self.assertEqual(token, session.csrf_token())

    def test_a_renewal_replaces_the_token(self) -> None:
        store = ArraySession()
        session = Session(store)
        token = session.csrf_token()
        session.renew()
        self.assertNotEqual(token, session.csrf_token())
        self.assertEqual(1, store._renewal_count())

    def test_flash_values_are_taken_once(self) -> None:
        session = Session(ArraySession())
        session.put_flash(Flash({"created": 7}, []))
        taken = session.take_flash()
        self.assertEqual({"created": 7}, taken.values)
        self.assertEqual([], taken.changed)
        self.assertEqual({}, session.take_flash().values)

    def test_kept_values_are_stored_by_region_and_path(self) -> None:
        session = Session(ArraySession())
        session.keep("rows", "open", True)
        session.keep("rows", "sort", "title")
        self.assertEqual({"open": True, "sort": "title"}, session.kept("rows"))
        self.assertEqual({}, session.kept("reader"))


if __name__ == "__main__":
    unittest.main()
