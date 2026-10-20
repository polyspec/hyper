# The client rendering of the conformance cases (HY-62). The PHP and the Node server pass the same cases of
# contracts/client.json against the same fixtures. Each case is a test method test_<id> (S6).
import json
import unittest
from urllib.parse import urlencode

from polyspec.hyper._csrf import masked
from polyspec.hyper.request import Request
from polyspec.hyper.session import ArraySession

from ..contracts import add_cases
from .render_client import SHELL, TOKEN, Counter, app, conformance


class ClientConformanceTest(unittest.TestCase):
    def _check(self, case: dict) -> None:
        counter = Counter()
        session = ArraySession()
        spec = case["request"]
        form = {name: str(value) for name, value in (spec.get("form") or {}).items()}
        if spec.get("csrf"):
            session.set("_hyper_csrf", TOKEN)
            form = {"_csrf": masked(TOKEN), **form}
        headers = {
            name: str(value) for name, value in (spec.get("headers") or {}).items()
        }
        body = ""
        if form or "form" in spec:
            headers["Content-Type"] = "application/x-www-form-urlencoded"
            body = urlencode(form)
        target = spec["target"]
        question = target.find("?")
        query = "" if question < 0 else target[question + 1 :]
        path = target if question < 0 else target[:question]
        request = Request(spec["method"], path, headers, query, body.encode("utf-8"))
        response = app(counter).handle(request, session)

        self.assertEqual(case["status"], response.status)
        for name, value in case["headers"].items():
            self.assertEqual(value, response.headers.get(name), name)
        if case.get("shell"):
            self.assertEqual(SHELL.read_text(encoding="utf-8"), response.body)
            self.assertEqual(case["headers"], response.headers)
        if "body" in case:
            self.assertEqual(case["body"], response.body)
        if "json" in case:
            answered = json.loads(response.body)
            self.assertEqual(case["json"]["route"], answered.get("route"))
            self.assertEqual(case["json"]["params"], answered.get("params"))
            self.assertEqual(case["json"]["regions"], list(answered.get("regions", {})))
        if case.get("session") is False:
            self.assertIsNone(session.get("_hyper_csrf"))
        self.assertEqual(case["actions"], counter.actions)


add_cases(
    ClientConformanceTest,
    conformance()["cases"],
    lambda self, case: self._check(case),
)


if __name__ == "__main__":
    unittest.main()
