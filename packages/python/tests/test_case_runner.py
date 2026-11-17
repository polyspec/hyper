# The case runner of HYR-7 for python: runs every case of every case file whose runners name python, and writes one line
# per case to the results file named by RECIPE_RESULTS.
import os
import unittest
from pathlib import Path

from . import case_rules, case_selection
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
        readers: list[CaseReader] = []
        for file in files:
            try:
                readers.extend(CaseReader.cases(file))
            except (OSError, ValueError, KeyError) as error:
                errors.append(f"{file}: {error}")
        # With RECIPE_CASES the runner runs the cases that the selection names, and the first line of the results
        # file states the selection (H35.9-11); the caller names another results file than the one of a full run.
        # A selection that names no case raises here, before a case runs and before a results file is written (HR-84).
        selection = os.environ.get("RECIPE_CASES")
        if selection is not None:
            readers = case_selection.select(
                selection,
                readers,
                lambda reader: (reader.file(), reader.section(), reader.id()),
            )
            lines.append("SELECTION " + " ".join(case_selection.names(selection)))
        for reader in readers:
            file = reader.file()
            step = STEPS.get((file, reader.section()))
            if step is None:
                reader.fail(f"STEP_UNKNOWN {file} {reader.section()}")
            else:
                try:
                    step(reader)
                except Exception as error:  # noqa: BLE001 - HYR-7: every error of a step is the CASE_ERROR of its case
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
