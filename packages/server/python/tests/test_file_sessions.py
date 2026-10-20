# Two processes that write one session file at the same time (HY-104). Each process has its own session store, so the
# lock of a store does not hold the other process back, as two worker processes of one server do not.
import multiprocessing
import os
import secrets
import tempfile
import time
import unittest
from pathlib import Path

from polyspec.hyper.file_sessions import FileSessions, cookie_header, cookie_name

ROUNDS = 400


def write_rounds(directory: str, identifier: str, queue) -> None:
    """Opens the session of `identifier` and writes it ROUNDS times; reports each failed write to `queue`."""
    errors: list[str] = []
    try:
        sessions = FileSessions(directory)
        for number in range(ROUNDS):
            session = sessions.open(identifier)
            session.set("number", number)
            try:
                session.close()
            except OSError as error:
                errors.append(f"{type(error).__name__}: {error}")
    finally:
        queue.put(errors)


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
        first = self.sessions.open(None)
        first.set("a", 1)
        first.close()
        identifier = first.created
        old = time.time() - 1441
        os.utime(self.directory / identifier, (old, old))
        later = self.sessions.open(identifier)
        self.assertIsNone(later.get("a"))
        self.assertNotEqual(identifier, later.created)
        later.close()
        self.assertEqual(1, self.sessions.collect())
        self.assertFalse((self.directory / identifier).exists())

    def test_names_the_session_cookie_hy_session_over_http_and_host_prefixed_over_https(
        self,
    ) -> None:
        identifier = "a" * 64
        self.assertEqual("hy-session", cookie_name(False))
        self.assertEqual("__Host-hy-session", cookie_name(True))
        self.assertEqual(
            f"hy-session={identifier}; path=/; HttpOnly; SameSite=Lax",
            cookie_header(identifier, False),
        )
        self.assertEqual(
            f"__Host-hy-session={identifier}; path=/; secure; HttpOnly; SameSite=Lax",
            cookie_header(identifier, True),
        )

    def test_accepts_only_identifiers_that_it_created(self) -> None:
        for cookie in ["abc", "../../etc/passwd", "f" * 64, "F" * 64]:
            session = self.sessions.open(cookie)
            self.assertIsNone(session.get("a"), cookie)
            self.assertNotEqual(cookie, session.created, cookie)
            session.close()

    def test_renews_a_session_with_the_same_values_and_no_file_of_the_old_one(
        self,
    ) -> None:
        first = self.sessions.open(None)
        first.set("a", 1)
        first.close()
        old = first.created
        session = self.sessions.open(old)
        session.renew()
        session.close()
        self.assertNotEqual(old, session.created)
        self.assertEqual(
            [session.created], [file.name for file in self.directory.iterdir()]
        )
        self.assertEqual(1, self.sessions.open(session.created).get("a"))

    def test_requires_an_existing_absolute_directory_and_a_positive_lifetime(
        self,
    ) -> None:
        with self.assertRaisesRegex(ValueError, "absolute"):
            FileSessions("var/sessions")
        with self.assertRaisesRegex(ValueError, "lifetime"):
            FileSessions(str(self.directory), lifetime=0)


if __name__ == "__main__":
    unittest.main()
