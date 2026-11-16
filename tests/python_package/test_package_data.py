# The installed package carries the `py.typed` marker of the namespace package `polyspec.hyper` (H15.3-15, H35.7).
# `make hyper-install-python` builds the wheel of packages/python with maturin and installs it non-editable into the
# venv that runs this test, so the files of the installed distribution are the files of that wheel.
import importlib.metadata
import json
import unittest

DISTRIBUTION = "polyspec-hyper"
MARKER = "polyspec/hyper/py.typed"


class PackageDataTest(unittest.TestCase):
    def distribution(self) -> importlib.metadata.Distribution:
        try:
            return importlib.metadata.distribution(DISTRIBUTION)
        except importlib.metadata.PackageNotFoundError:
            self.fail(
                f"expected the distribution {DISTRIBUTION} in the venv: run make hyper-install-python"
            )

    def test_the_package_is_installed_from_its_wheel(self) -> None:
        text = self.distribution().read_text("direct_url.json")
        editable = bool(text) and json.loads(text).get("dir_info", {}).get(
            "editable", False
        )
        self.assertFalse(
            editable,
            f"expected {DISTRIBUTION} installed from its wheel, actual an editable install",
        )

    def test_the_wheel_carries_the_py_typed_marker(self) -> None:
        files = [str(path) for path in self.distribution().files or []]
        self.assertIn(
            MARKER,
            files,
            f"files of the installed {DISTRIBUTION}: expected {MARKER}, actual {files!r}",
        )
        marker = next(
            path for path in self.distribution().files or [] if str(path) == MARKER
        )
        self.assertTrue(
            marker.locate().is_file(), f"expected the installed file {marker.locate()}"
        )


if __name__ == "__main__":
    unittest.main()
