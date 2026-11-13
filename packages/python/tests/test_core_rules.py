# The rules of the core behind the names of the units of the Python server (polyspec/hyper/app/_core_rules.py,
# HY-132.2), against a stand-in of the module of the Python binding: the stand-in records each call and returns the
# value that the test gives it, so the tests need no native module. They state which member of the binding each unit
# calls, with which arguments, and what the unit returns; the rules themselves are tested in the core.
import types
import unittest

from polyspec.hyper.app._core_rules import _MEMBERS, CoreRules

TOKEN = "a" * 64
MASK = "b" * 64
PAGES = object()


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
    ("Csrf.mask (HY-24.2)", "csrf_mask", lambda rules: rules.Csrf.mask(TOKEN, MASK), (TOKEN, MASK), "masked"),
    ("Csrf.verify (HY-24.4)", "csrf_verify", lambda rules: rules.Csrf.verify(TOKEN, "value"), (TOKEN, "value"), True),
    ("Csrf.browser_of (HY-24.10)", "browser", lambda rules: rules.Csrf.browser_of("masked"), ("masked",), "digest"),
    ("Csrf.browser_of without a session (HY-24.12)", "browser", lambda rules: rules.Csrf.browser_of(""), ("",), None),
    ("Context.hash (HY-125.12)", "context_hash", lambda rules: rules.Context.hash("build", "{}"), ("build", "{}"), "hash"),
    ("Context.valid_header (HY-127.2)", "valid_context_header", lambda rules: rules.Context.valid_header(None), (None,), True),
    ("RecordSession.cookie_name (HY-45.1)", "session_name", lambda rules: rules.RecordSession.cookie_name(True), (True,), "__Host-hy-session"),
    ("RepresentationResponse.etag (HY-122.10)", "representation_tag", lambda rules: rules.RepresentationResponse.etag("application/json", '{"a":"é"}'), ("application/json", '{"a":"é"}'.encode("utf-8")), '"tag"'),
    ("Request.current_path (HY-11.4)", "current_path", lambda rules: rules.Request.current_path("http://a.test/b?c"), ("http://a.test/b?c",), "/b"),
    ("Reply.cache_control (HY-52.6)", "cache_control", lambda rules: rules.Reply.cache_control("private"), ("private",), "private"),
    ("Reply.referrer_policy (HY-103.2)", "referrer_policy", lambda rules: rules.Reply.referrer_policy("origin"), ("origin",), "origin"),
    ("Reply.status (HY-69)", "reply_status", lambda rules: rules.Reply.status(403), (403,), 403),
    ("Result.redirect (HY-46)", "redirect_location", lambda rules: rules.Result.redirect("/list"), ("/list",), "/list"),
    ("Result.page (HY-58)", "page_status", lambda rules: rules.Result.page(422), (422,), 422),
    ("App._vary_header (HY-117.1)", "page_vary", lambda rules: rules.App.vary_header(True), (True,), "Accept, HX-Request, HX-Current-URL, Hyper-Context"),
    ("the tag of Page.respond (HY-53.1)", "page_tag", lambda rules: rules.Page.tag("{}", "masked", TOKEN), ("{}", "masked", TOKEN), 'W/"0"'),
]

# The partial units, which return the result of their member as it is.
PARTIAL = [
    ("RecordSession.cookie_header (HY-45.8)", "session_cookie", lambda rules: rules.RecordSession.cookie_header("id", True), ("id", True), "__Host-hy-session=id; Path=/; Secure; HttpOnly; SameSite=Lax"),
    ("Reply.keeps_out_of_shared_caches (HY-52.6)", "keeps_out_of_shared_caches", lambda rules: rules.Reply.keeps_out_of_shared_caches("private"), ("private",), True),
    ("Result.is_application_path (HY-46)", "is_application_path", lambda rules: rules.Result.is_application_path("//a"), ("//a",), False),
    ("App.check_shell_path (HY-62)", "check_shell_path", lambda rules: rules.App.check_shell_path("/srv/csr/index.html"), ("/srv/csr/index.html",), None),
    ("App.shell_text (HY-62)", "shell_text", lambda rules: rules.App.shell_text("/srv/csr/index.html", b"<html>"), ("/srv/csr/index.html", b"<html>"), "<html>"),
    ("App.kept_value (HY-40.1)", "kept_value", lambda rules: rules.App.kept_value(PAGES, "rows", "open", "true"), (PAGES, "rows", "open", "true"), True),
    ("Session.stored_token (HY-24.14)", "stored_token", lambda rules: rules.Session.stored_token(TOKEN), (TOKEN,), TOKEN),
    ("Kept.cookie_name (HYC-13.6)", "keep_name", lambda rules: rules.Kept.cookie_name(False), (False,), "hy-keep"),
    ("Build.read (HY-125.18)", "read_build", lambda rules: rules.Build.read(b"{}"), (b"{}",), "1" * 64),
    ("Build.check_id (HY-125.19)", "check_build_id", lambda rules: rules.Build.check_id("1" * 64), ("1" * 64,), None),
]


class CoreRulesTest(unittest.TestCase):
    def test_each_unit_calls_its_member_with_its_arguments_and_returns_its_result(self):
        for label, name, call, args, result in EXACT + PARTIAL:
            with self.subTest(label):
                core, calls = stand_in({name: result})
                self.assertEqual(call(CoreRules(core)), result)
                self.assertEqual(calls, [(name, args)])

    def test_there_are_fifteen_exact_units(self):
        self.assertEqual(len({name for _, name, _, _, _ in EXACT}), 15)

    def test_the_frame_headers_are_a_record_in_the_order_of_the_core(self):
        # HY-45.5, HY-65.1
        pairs = [("Content-Security-Policy", "frame-ancestors 'self'"), ("Cache-Control", "no-store")]
        core, calls = stand_in({"frame_headers": pairs})
        headers = CoreRules(core).App.frame_headers(403, "'self'")
        self.assertEqual(list(headers.items()), pairs)
        self.assertEqual(calls, [("frame_headers", (403, "'self'"))])

    def test_a_failure_of_the_binding_reaches_the_caller_as_the_binding_raised_it(self):
        # HY-132.1, HY-132.2; HY-24.14 for a session that holds another value in the place of the token.
        failure = ValueError("the session holds a token of another form")
        failure.kind = "invalid_session_token"
        core, _ = stand_in({"csrf_mask": failure, "stored_token": failure})
        rules = CoreRules(core)
        with self.assertRaises(ValueError) as raised:
            rules.Csrf.mask("x", MASK)
        self.assertIs(raised.exception, failure)
        with self.assertRaises(ValueError) as raised:
            rules.Session.stored_token("conformance-token")
        self.assertIs(raised.exception, failure)

    def test_a_module_without_a_member_of_the_binding_fails_with_the_name_of_the_member(self):
        core, _ = stand_in({})
        del core.csrf_mask
        del core.read_build
        with self.assertRaises(RuntimeError) as raised:
            CoreRules(core)
        self.assertEqual(str(raised.exception), "hyper: the binding of the core has no member csrf_mask, read_build")
