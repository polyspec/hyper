# The session files (HY-45, HY-72) and several processes that use one session at the same time (HY-104). Each process has its own session store, as each
# worker process of one server has, so only the lock file of the session holds the other processes back.
import json
import multiprocessing
import os
import secrets
import tempfile
import time
import unittest
from pathlib import Path

from polyspec.hyper.file_sessions import FileSessions, _cookie_header, _cookie_name

ROUNDS = 400
PROCESSES = 4
REQUESTS = 200


def write_rounds(directory: str, identifier: str, queue) -> None:
    """Opens the session of `identifier` and writes it ROUNDS times; reports each failed write to `queue`."""
    errors: list[str] = []
    try:
        sessions = FileSessions(directory)
        for number in range(ROUNDS):
            session = sessions._open(identifier)
            session.set("number", number)
            try:
                session._close()
            except OSError as error:
                errors.append(f"{type(error).__name__}: {error}")
    finally:
        queue.put(errors)


def count_requests(directory: str, identifier: str, queue) -> None:
    """Runs REQUESTS requests of the session of `identifier`; each reads the token and adds one to the count, as a form
    post reads the CSRF token and writes a flash value. Reports the requests that found no session; an error ends the
    process with a nonzero exit code."""
    failures: list[str] = []
    try:
        sessions = FileSessions(directory)
        for _ in range(REQUESTS):
            session = sessions._open(identifier)
            try:
                if session.get("token") is None:
                    failures.append(
                        f"a request started the new session {session._created}"
                    )
                session.set("count", (session.get("count") or 0) + 1)
            finally:
                session._close()
    finally:
        queue.put(failures)


class ConcurrentSessionRequests(unittest.TestCase):
    def test_runs_the_requests_of_one_session_in_several_processes_one_after_another(
        self,
    ) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        identifier = secrets.token_bytes(32).hex()
        (Path(directory.name) / identifier).write_text(
            json.dumps({"token": "t", "count": 0}), encoding="utf-8"
        )
        context = multiprocessing.get_context("spawn")
        queue = context.Queue()
        processes = [
            context.Process(
                target=count_requests, args=(directory.name, identifier, queue)
            )
            for _ in range(PROCESSES)
        ]
        for process in processes:
            process.start()
        failures = [queue.get() for _ in processes]
        for process in processes:
            process.join()
        self.assertEqual([0] * PROCESSES, [process.exitcode for process in processes])
        self.assertEqual([[]] * PROCESSES, failures)
        stored = json.loads((Path(directory.name) / identifier).read_text("utf-8"))
        self.assertEqual(
            PROCESSES * REQUESTS,
            stored["count"],
            "expected every request to add one to the count, actual a count that lost the writes of some requests",
        )


class ConcurrentSessionWrites(unittest.TestCase):
    def test_two_processes_writing_one_session_do_not_fail(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        identifier = secrets.token_bytes(32).hex()
        (Path(directory.name) / identifier).write_text("{}", encoding="utf-8")
        context = multiprocessing.get_context("spawn")
        queue = context.Queue()
        processes = [
            context.Process(
                target=write_rounds, args=(directory.name, identifier, queue)
            )
            for _ in range(2)
        ]
        for process in processes:
            process.start()
        errors = [queue.get() for _ in processes]
        for process in processes:
            process.join()
        self.assertEqual(
            [[], []],
            errors,
            "expected no failed write, actual the failed writes of each process above",
        )


class FileSessionsTest(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.directory = Path(directory.name)
        self.sessions = FileSessions(directory.name)

    def test_ends_a_session_after_its_lifetime_and_removes_expired_files(self) -> None:
        first = self.sessions._open(None)
        first.set("a", 1)
        first._close()
        identifier = first._created
        old = time.time() - 1441
        os.utime(self.directory / identifier, (old, old))
        later = self.sessions._open(identifier)
        self.assertIsNone(later.get("a"))
        self.assertNotEqual(identifier, later._created)
        later._close()
        self.assertEqual(1, self.sessions._collect())
        self.assertEqual(
            [later._created], [file.name for file in self.directory.iterdir()]
        )

    def test_raises_when_a_session_file_cannot_be_read_and_starts_no_new_session(
        self,
    ) -> None:
        identifier = secrets.token_bytes(32).hex()
        (self.directory / identifier).write_text('{"token": ', encoding="utf-8")
        session = self.sessions._open(identifier)
        with self.assertRaises(json.JSONDecodeError):
            session.get("token")
        session._close()
        self.assertIsNone(session._created)

    def test_keeps_a_lock_file_only_beside_its_session_file(self) -> None:
        unknown = self.sessions._open("e" * 64)
        unknown.get("a")
        unknown._close()
        first = self.sessions._open(None)
        first.set("a", 1)
        first._close()
        kept = self.sessions._open(first._created)
        kept.get("a")
        kept._close()
        self.assertEqual(
            sorted([unknown._created, first._created, f"{first._created}.lock"]),
            sorted(file.name for file in self.directory.iterdir()),
        )

    def test_names_the_session_cookie_hy_session_over_http_and_host_prefixed_over_https(
        self,
    ) -> None:
        identifier = "a" * 64
        self.assertEqual("hy-session", _cookie_name(False))
        self.assertEqual("__Host-hy-session", _cookie_name(True))
        self.assertEqual(
            f"hy-session={identifier}; path=/; HttpOnly; SameSite=Lax",
            _cookie_header(identifier, False),
        )
        self.assertEqual(
            f"__Host-hy-session={identifier}; path=/; secure; HttpOnly; SameSite=Lax",
            _cookie_header(identifier, True),
        )

    def test_accepts_only_identifiers_that_it_created(self) -> None:
        for cookie in ["abc", "../../etc/passwd", "f" * 64, "F" * 64]:
            session = self.sessions._open(cookie)
            self.assertIsNone(session.get("a"), cookie)
            self.assertNotEqual(cookie, session._created, cookie)
            session._close()

    def test_renews_a_session_with_the_same_values_and_no_file_of_the_old_one(
        self,
    ) -> None:
        first = self.sessions._open(None)
        first.set("a", 1)
        first._close()
        old = first._created
        session = self.sessions._open(old)
        session.renew()
        session._close()
        self.assertNotEqual(old, session._created)
        self.assertEqual(
            [session._created], [file.name for file in self.directory.iterdir()]
        )
        self.assertEqual(1, self.sessions._open(session._created).get("a"))

    def test_requires_an_existing_absolute_directory_and_a_positive_lifetime(
        self,
    ) -> None:
        with self.assertRaisesRegex(ValueError, "absolute"):
            FileSessions("var/sessions")
        with self.assertRaisesRegex(ValueError, "lifetime"):
            FileSessions(str(self.directory), lifetime=0)


if __name__ == "__main__":
    unittest.main()
