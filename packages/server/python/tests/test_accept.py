# The Accept parser and the selection of the media type among text/html and application/vnd.hyper+json (HY-116,
# HY-119). The expected values are the values of the rules and of contracts/representations.json.
import unittest

from polyspec.hyper._accept import InvalidAccept, Range, parse
from polyspec.hyper._media import JSON, TEXT_HTML, select

CANDIDATES = (TEXT_HTML, JSON)


def chosen(value):
    """Returns the type that the selection of the two page types chooses for an Accept value, or None."""
    return select(parse(value), CANDIDATES)


class ParseTest(unittest.TestCase):
    def test_a_missing_header_is_the_any_range(self) -> None:
        self.assertEqual([Range("*", "*", (), 1000)], parse(None))

    def test_an_empty_value_is_an_empty_list(self) -> None:
        self.assertEqual([], parse(""))
        self.assertEqual([], parse(" \t"))

    def test_a_range_gives_its_type_subtype_and_weight(self) -> None:
        self.assertEqual(
            [Range("text", "html", (), 1000)], parse("text/html")
        )
        self.assertEqual(
            [Range("text", "*", (), 1000)], parse("text/*")
        )

    def test_types_subtypes_parameter_names_and_q_compare_without_case(self) -> None:
        self.assertEqual(
            [Range("text", "html", (("charset", "UTF-8"),), 500)],
            parse("Text/HTML; Charset=UTF-8; Q=0.5"),
        )

    def test_parameters_before_q_are_kept_and_an_accept_extension_is_not(self) -> None:
        self.assertEqual(
            [Range("application", "vnd.example+json", (("version", "2"),), 900)],
            parse("application/vnd.example+json;version=2;q=0.9"),
        )
        self.assertEqual(
            [Range("application", "vnd.example+json", (), 500)],
            parse("application/vnd.example+json;q=0.5;version=2"),
        )

    def test_a_quoted_value_unquotes_its_quoted_pairs_and_keeps_its_commas(self) -> None:
        self.assertEqual(
            [Range("text", "html", (("x", 'a,b"c'),), 1000)],
            parse('text/html;x="a,b\\"c"'),
        )

    def test_a_list_keeps_the_order_of_its_ranges(self) -> None:
        self.assertEqual(
            [
                Range("text", "html", (), 500),
                Range("application", "vnd.hyper+json", (), 900),
            ],
            parse("text/html;q=0.5, application/vnd.hyper+json;q=0.9"),
        )

    def test_empty_list_elements_are_ignored(self) -> None:
        self.assertEqual(
            [
                Range("text", "html", (), 1000),
                Range("application", "vnd.hyper+json", (), 1000),
            ],
            parse("text/html,, application/vnd.hyper+json,"),
        )

    def test_qvalues_have_at_most_three_decimals(self) -> None:
        self.assertEqual(0, parse("text/html;q=0")[0].weight)
        self.assertEqual(1000, parse("text/html;q=1")[0].weight)
        self.assertEqual(123, parse("text/html;q=0.123")[0].weight)
        self.assertEqual(1000, parse("text/html;q=1.000")[0].weight)

    def test_an_invalid_weight_is_invalid(self) -> None:
        for value in ["text/html;q=1.5", "text/html;q=x", "text/html;q=1.001"]:
            with self.subTest(value=value):
                with self.assertRaises(InvalidAccept):
                    parse(value)

    def test_a_grammar_error_is_invalid(self) -> None:
        for value in [
            "text",
            "*/html",
            "text/html/x",
            "text/html;q = 0.5",
            'text/html;q="0.5"',
            "text/html;a=b c",
            "text/html;",
        ]:
            with self.subTest(value=value):
                with self.assertRaises(InvalidAccept):
                    parse(value)


class SelectTest(unittest.TestCase):
    def test_a_request_without_accept_selects_the_page(self) -> None:
        self.assertEqual(TEXT_HTML, chosen(None))

    def test_the_any_range_selects_the_page(self) -> None:
        self.assertEqual(TEXT_HTML, chosen("*/*"))

    def test_the_text_range_selects_the_page(self) -> None:
        self.assertEqual(TEXT_HTML, chosen("text/*"))

    def test_the_application_range_selects_the_page_data(self) -> None:
        self.assertEqual(JSON, chosen("application/*"))

    def test_an_empty_accept_matches_no_type(self) -> None:
        self.assertIsNone(chosen(""))

    def test_q_values_select_the_type_of_the_highest_weight(self) -> None:
        self.assertEqual(JSON, chosen("text/html;q=0.5, application/vnd.hyper+json;q=0.9"))

    def test_the_most_specific_range_gives_the_weight(self) -> None:
        self.assertEqual(
            JSON, chosen("text/html;q=0.2, text/*;q=0.9, application/vnd.hyper+json;q=0.5")
        )

    def test_a_page_type_range_with_parameters_matches_at_the_type_specificity(self) -> None:
        self.assertEqual(
            JSON,
            chosen(
                "text/html; charset=utf-8;q=0.1, text/*;q=0.9, application/vnd.hyper+json;q=0.5"
            ),
        )

    def test_a_page_data_range_with_other_parameters_matches_the_page_data(self) -> None:
        self.assertEqual(JSON, chosen("application/vnd.hyper+json; profile=x"))

    def test_the_highest_weight_among_page_type_ranges_gives_the_weight(self) -> None:
        self.assertEqual(TEXT_HTML, chosen("text/html;level=1;q=0, text/html;q=0.8"))

    def test_q_zero_on_a_specific_range_with_the_any_range(self) -> None:
        self.assertEqual(JSON, chosen("text/html;q=0, */*"))

    def test_q_zero_on_the_page_data_with_a_wildcard_leaves_no_type(self) -> None:
        self.assertIsNone(chosen("application/vnd.hyper+json;q=0, application/*;q=0.5"))

    def test_the_wildcard_of_the_type_gives_the_page_data_its_weight(self) -> None:
        # application/* matches application/vnd.hyper+json at the specificity of its type, and application/json
        # names no page type, so the page data takes 0.9.
        self.assertEqual(JSON, chosen("application/json;q=0.1, application/*;q=0.9"))

    def test_a_tie_prefers_the_page_type_to_the_page_data(self) -> None:
        self.assertEqual(TEXT_HTML, chosen("application/vnd.hyper+json, text/html"))

    def test_the_type_of_the_highest_weight_is_selected(self) -> None:
        self.assertEqual(JSON, chosen("application/vnd.hyper+json"))
        self.assertEqual(TEXT_HTML, chosen("*/*, text/html"))

    def test_a_range_that_names_no_page_type_matches_none(self) -> None:
        self.assertIsNone(chosen("application/json; charset=utf-8"))
        self.assertIsNone(chosen("image/png"))

    def test_a_weight_of_zero_makes_the_type_not_acceptable(self) -> None:
        self.assertIsNone(chosen("text/html;q=0"))


if __name__ == "__main__":
    unittest.main()
