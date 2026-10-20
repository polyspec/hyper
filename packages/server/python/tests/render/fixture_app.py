"""Where the render tests find the fixtures of the PHP tests and the server program that they build."""

from pathlib import Path

TESTS = Path(__file__).resolve().parents[2]
FIXTURES = TESTS.parent / "php" / "tests" / "fixtures"
PROGRAM = FIXTURES.parent / "build" / "server"
