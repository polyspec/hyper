# The rules of the core behind the names of the units of the Python server (polyspec/hyper/app/_core_rules.py,
# HY-133.2), against a stand-in of the module of the Python binding: the stand-in records each call and returns the
# value that the test gives it, so the tests need no native module. They state which member of the binding each unit
# calls, with which arguments, and what the unit returns; the rules themselves are tested in the core.
import sys
import types
import unittest
import unittest.mock

from polyspec.hyper.app._core_rules import _MEMBERS, CoreRules

TOKEN = "a" * 64
MASK = "b" * 64


def stand_in(results):
    """A stand-in of the binding module: every member records its call and returns `results[name]`, or raises it when
    it is an exception."""
    calls = []

    def member(name):
        def call(*args):
            calls.append((name, args))
            result = results.get(name)
            if isinstance(result, BaseException):
                raise result
            return result

        return call

    return types.SimpleNamespace(**{name: member(name) for name in _MEMBERS}), calls


# The exact units: the unit of the server, the member of the binding, the call, the arguments that the member must
# receive and the value that the member returns, which the unit returns as it is.
EXACT = [
    (
        "Csrf.mask (HY-24.2)",
        "csrf_mask",
        lambda rules: rules.csrf_mask(TOKEN, MASK),
        (TOKEN, MASK),
        "masked",
    ),
    (
        "Csrf.verify (HY-24.4)",
        "csrf_verify",
        lambda rules: rules.csrf_verify(TOKEN, "value"),
        (TOKEN, "value"),
        True,
    ),
    (
        "Csrf.browser_of (HY-24.10)",
        "browser",
        lambda rules: rules.csrf_browser_of("masked"),
        ("masked",),
        "digest",
    ),
    (
        "Csrf.browser_of without a session (HY-24.12)",
        "browser",
        lambda rules: rules.csrf_browser_of(""),
        ("",),
        None,
    ),
    (
        "Context.hash (HY-125.12)",
        "context_hash",
        lambda rules: rules.context_hash("build", "{}"),
        ("build", "{}"),
        "hash",
    ),
    (
        "Context.valid_header (HY-127.2)",
        "valid_context_header",
        lambda rules: rules.context_valid_header(None),
        (None,),
        True,
    ),
    (
        "JsonCodec.decode (HY-54.20)",
        "json_read",
        lambda rules: rules.json_codec_decode('{"a":"é"}'),
        ('{"a":"é"}'.encode("utf-8"),),
        {"a": "é"},
    ),
    (
        "JsonCodec.encode (HY-54.18)",
        "json_write",
        lambda rules: rules.json_codec_encode({"a": -0.0}),
        ({"a": -0.0},),
        '{"a":0}',
    ),
    (
        "Session.take_flash (HY-25.2)",
        "flash_of",
        lambda rules: rules.session_flash_of({"values": {}}),
        ({"values": {}},),
        {"values": {}, "changed": []},
    ),
    (
        "Session.kept (HY-104.22)",
        "kept_of",
        lambda rules: rules.session_kept_of({"r": {}}),
        ({"r": {}},),
        {"r": {}},
    ),
    (
        "RecordSession.cookie_name (HY-45.1)",
        "session_name",
        lambda rules: rules.session_cookie_name(True),
        (True,),
        "__Host-hy-session",
    ),
    (
        "RepresentationResponse.etag (HY-122.10)",
        "representation_tag",
        lambda rules: rules.representation_etag("application/json", '{"a":"é"}'),
        ("application/json", '{"a":"é"}'.encode("utf-8")),
        '"tag"',
    ),
    (
        "Request.media_type (HY-59.13)",
        "media_type",
        lambda rules: rules.request_media_type("text/plain; charset=UTF-8"),
        ("text/plain; charset=UTF-8",),
        "text/plain",
    ),
    (
        "Request.file_over (HY-114.12)",
        "file_over",
        lambda rules: rules.request_file_over([3, 9], 8),
        ([3, 9], 8),
        True,
    ),
    (
        "Request.current_path (HY-11.5)",
        "current_path",
        lambda rules: rules.request_current_path("http://a.test/b?c"),
        ("http://a.test/b?c",),
        "/b",
    ),
    (
        "Reply.cache_control (HY-52.6)",
        "cache_control",
        lambda rules: rules.reply_cache_control("private"),
        ("private",),
        "private",
    ),
    (
        "Reply.referrer_policy (HY-103.2)",
        "referrer_policy",
        lambda rules: rules.reply_referrer_policy("origin"),
        ("origin",),
        "origin",
    ),
    (
        "Reply.status (HY-69)",
        "reply_status",
        lambda rules: rules.reply_status(403),
        (403,),
        403,
    ),
    (
        "Result.redirect (HY-46)",
        "redirect_location",
        lambda rules: rules.result_redirect("/list"),
        ("/list",),
        "/list",
    ),
    (
        "Result.page (HY-58)",
        "page_status",
        lambda rules: rules.result_page(422),
        (422,),
        422,
    ),
    (
        "App._vary_header (HY-117.1)",
        "page_vary",
        lambda rules: rules.app_vary_header(True),
        (True,),
        "Accept, HX-Request, HX-Current-URL, Hyper-Context",
    ),
]

# The partial units, which return the result of their member as it is.
PARTIAL = [
    (
        "RecordSession.cookie_header (HY-45.8)",
        "session_cookie",
        lambda rules: rules.session_cookie_header("id", True),
        ("id", True),
        "__Host-hy-session=id; Path=/; Secure; HttpOnly; SameSite=Lax",
    ),
    (
        "App.check_shell_path (HY-62)",
        "check_shell_path",
        lambda rules: rules.app_check_shell_path("/srv/csr/index.html"),
        ("/srv/csr/index.html",),
        None,
    ),
    (
        "App.shell_text (HY-62)",
        "shell_text",
        lambda rules: rules.app_shell_text("/srv/csr/index.html", b"<html>"),
        ("/srv/csr/index.html", b"<html>"),
        "<html>",
    ),
    (
        "Session.stored_token (HY-24.14)",
        "stored_token",
        lambda rules: rules.session_stored_token(TOKEN),
        (TOKEN,),
        TOKEN,
    ),
    (
        "Kept.cookie_name (HYC-13.6)",
        "keep_name",
        lambda rules: rules.kept_cookie_name(False),
        (False,),
        "hy-keep",
    ),
    (
        "Build.read (HY-125.23)",
        "read_build",
        lambda rules: rules.build_read(b"{}"),
        (b"{}",),
        "1" * 64,
    ),
]


class CoreRulesTest(unittest.TestCase):
    def test_each_unit_calls_its_member_with_its_arguments_and_returns_its_result(self):
        for label, name, call, args, result in EXACT + PARTIAL:
            with self.subTest(label):
                core, calls = stand_in({name: result})
                self.assertEqual(call(CoreRules(core)), result)
                self.assertEqual(calls, [(name, args)])

    def test_there_are_twenty_two_exact_units(self):
        self.assertEqual(len({name for _, name, _, _, _ in EXACT}), 22)

    def test_the_frame_headers_are_a_record_in_the_order_of_the_core(self):
        # HY-45.5, HY-65.1
        pairs = [
            ("Content-Security-Policy", "frame-ancestors 'self'"),
            ("Cache-Control", "no-store"),
        ]
        core, calls = stand_in({"frame_headers": pairs})
        headers = CoreRules(core).app_frame_headers(403, "'self'")
        self.assertEqual(list(headers.items()), pairs)
        self.assertEqual(calls, [("frame_headers", (403, "'self'"))])

    def test_the_accept_parse_gives_the_core_one_field_line_or_none_for_a_missing_field(
        self,
    ):
        # HY-116.17: a request without Accept has no field line.
        core, calls = stand_in({"accept_ranges": []})
        rules = CoreRules(core)
        self.assertEqual(rules.accept_parse("text/html"), [])
        self.assertEqual(rules.accept_parse(None), [])
        self.assertEqual(
            calls, [("accept_ranges", (["text/html"],)), ("accept_ranges", ([],))]
        )

    def test_a_failure_of_the_binding_reaches_the_caller_as_the_binding_raised_it(self):
        # HY-133.1, HY-133.2; HY-24.14 for a session that holds another value in the place of the token.
        failure = ValueError("the session holds a token of another form")
        failure.kind = "invalid_session_token"
        core, _ = stand_in({"csrf_mask": failure, "stored_token": failure})
        rules = CoreRules(core)
        with self.assertRaises(ValueError) as raised:
            rules.csrf_mask("x", MASK)
        self.assertIs(raised.exception, failure)
        with self.assertRaises(ValueError) as raised:
            rules.session_stored_token("conformance-token")
        self.assertIs(raised.exception, failure)

    def test_a_module_without_a_member_of_the_binding_fails_with_the_name_of_the_member(
        self,
    ):
        core, _ = stand_in({})
        del core.csrf_mask
        del core.read_build
        with self.assertRaises(RuntimeError) as raised:
            CoreRules(core)
        self.assertEqual(
            str(raised.exception),
            "hyper: the binding of the core has no member csrf_mask, read_build",
        )


class BodyLimitsTest(unittest.TestCase):
    """The binding takes a `uint` only up to 2^53 - 1 and fails a larger one with `invalid_number` (binding GN-12a),
    so every limit that the server gives the core is at most that integer (H35.11)."""

    def test_the_limit_that_does_not_apply_is_the_largest_uint_of_the_binding(self):
        from polyspec.hyper.form._body_reader import NO_LIMIT

        self.assertEqual(NO_LIMIT, 2**53 - 1)

    def test_a_limit_above_the_largest_uint_reaches_the_binding_as_that_uint(self):
        from polyspec.hyper.form._body_reader import BodyReader

        received = {}

        def read_held_body(content_type, body, **limits):
            received.update(limits)
            return types.SimpleNamespace(fields=[], files=[])

        binding = types.SimpleNamespace(read_held_body=read_held_body)
        package = types.ModuleType("polyspec.hyper._binding")
        package._root = binding
        with unittest.mock.patch.dict(
            sys.modules,
            {package.__name__: package, "polyspec.hyper._binding._root": binding},
        ):
            BodyReader.held_form("text/plain", b"", 2**64 - 1, 7, 2**53)
        self.assertEqual(
            received,
            {
                "limit": 2**53 - 1,
                "value_limit": 2**53 - 1,
                "part_limit": 7,
                "file_limit": 2**53 - 1,
            },
        )


class SharedCoreRulesTest(unittest.TestCase):
    """`CoreRules.shared` gives the units of the server one `CoreRules` of the binding module, and a binding that does not
    import fails with an error that names the module, with no rule of the server in its place (HY-133.2)."""

    def setUp(self):
        from polyspec.hyper.app import _core_rules

        self.module = _core_rules
        self.addCleanup(
            setattr, CoreRules, "_CoreRules__shared", CoreRules._CoreRules__shared
        )
        CoreRules._CoreRules__shared = None

    def test_the_shared_rules_are_one_instance(self):
        binding, _ = stand_in({})
        package = types.ModuleType("polyspec.hyper._binding")
        package._root = binding
        with unittest.mock.patch.dict(
            sys.modules,
            {package.__name__: package, self.module.BINDING: binding},
        ):
            first = CoreRules.shared()
            self.assertIs(first, CoreRules.shared())
        self.assertIsInstance(first, CoreRules)

    def test_a_binding_that_does_not_import_fails_with_the_name_of_the_module(self):
        from polyspec.hyper.session._csrf import Csrf

        # The package of the binding imports its module `_root` and keeps it as an attribute, so a module that does not
        # import fails the import of the package too; both names are absent here, as they are after that failure.
        package = self.module.BINDING.rpartition(".")[0]
        with unittest.mock.patch.dict(
            sys.modules, {package: None, self.module.BINDING: None}
        ):
            with self.assertRaises(self.module.CoreBindingError) as raised:
                CoreRules.shared()
            self.assertIn("polyspec.hyper._binding._root", str(raised.exception))
            # No rule of the server answers in place of the core.
            with self.assertRaises(self.module.CoreBindingError):
                Csrf.mask("a" * 64, "b" * 64)
