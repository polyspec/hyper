# The case runner of HYR-7 for python: runs every case of every case file whose runners name python, and writes one line
# per case to the results file named by RECIPE_RESULTS.
import os
import unittest
from pathlib import Path

from . import case_rules
from .case_reader import CaseReader
from .steps import STEPS


class CaseRunner(unittest.TestCase):
    def test_cases(self) -> None:
        results = os.environ.get("RECIPE_RESULTS")
        if not results:
            self.fail("RECIPE_RESULTS names no results file")
        files = case_rules.case_files()
        lines: list[str] = []
        errors: list[str] = []
        for file in files:
            try:
                readers = CaseReader.cases(file)
            except (OSError, ValueError, KeyError) as error:
                errors.append(f"{file}: {error}")
                continue
            for reader in readers:
                step = STEPS.get((file, reader.section()))
                if step is None:
                    reader.fail(f"STEP_UNKNOWN {file} {reader.section()}")
                else:
                    try:
                        step(reader)
                    # HYR-7: every error that a step raises is the CASE_ERROR of its case.
                    except Exception as error:  # noqa: BLE001
                        reader.fail(str(error) or type(error).__name__)
                lines.append(reader.line())
        path = Path(results)
        temporary = path.with_name(path.name + ".tmp")
        temporary.write_text("".join(f"{line}\n" for line in lines), encoding="utf-8")
        os.replace(temporary, path)
        self.assertEqual([], errors, "case files that the runner cannot read")
        failing = [line for line in lines if " FAIL " in line]
        self.assertEqual([], failing, f"{len(failing)} case(s) failed")


if __name__ == "__main__":
    unittest.main()
