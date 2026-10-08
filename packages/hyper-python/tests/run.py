"""Runs every test of this directory with `unittest` and fails when no test ran (HY-84)."""

import sys
import unittest
from pathlib import Path

TESTS = Path(__file__).resolve().parent


def main() -> int:
    suite = unittest.TestLoader().discover(TESTS, pattern='test_*.py', top_level_dir=TESTS)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if result.testsRun == 0:
        print('no test ran: expected at least 1 test that passes, fails or errors, actual 0', file=sys.stderr)
        return 1
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    sys.exit(main())
