"""Runs every test of a directory with `unittest` and fails when no test ran (HY-84).

Usage: run.py [directory] [pattern]   the directory defaults to the one of this file and the pattern to test_*.py;
`make test-python-render` passes the directory of the rendering tests and their pattern render_*.py, so that the
tests of `make test-python`, which need no template package, never load them."""

import sys
import unittest
from pathlib import Path

TESTS = Path(__file__).resolve().parent


def main() -> int:
    directory = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else TESTS
    pattern = sys.argv[2] if len(sys.argv) > 2 else 'test_*.py'
    suite = unittest.TestLoader().discover(directory, pattern=pattern, top_level_dir=directory)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if result.testsRun == 0:
        print('no test ran: expected at least 1 test that passes, fails or errors, actual 0', file=sys.stderr)
        return 1
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    sys.exit(main())
