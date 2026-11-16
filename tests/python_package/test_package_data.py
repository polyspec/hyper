# The package data of `pyproject.toml` (H15.3-15, H35.7): maturin builds the package from its `python-source`, which
# holds the namespace package `polyspec.hyper` with its `py.typed` marker, so a built package carries the marker.
import tomllib
import unittest
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[2] / "packages" / "python"


class PackageDataTest(unittest.TestCase):
    def maturin(self) -> dict:
        with (PACKAGE / "pyproject.toml").open("rb") as file:
            declared = tomllib.load(file)
        return declared.get("tool", {}).get("maturin", {})

    def test_the_python_source_is_a_directory_of_the_package(self) -> None:
        source = self.maturin().get("python-source")
        self.assertIsNotNone(
            source,
            "tool.maturin of pyproject.toml: expected a python-source, actual none",
        )
        self.assertTrue(
            (PACKAGE / source).is_dir(),
            f"tool.maturin python-source {source!r}: expected the directory {PACKAGE / source} to exist",
        )

    def test_namespace_package_declares_py_typed(self) -> None:
        source = PACKAGE / self.maturin().get("python-source", "src")
        marker = source / "polyspec" / "hyper" / "py.typed"
        self.assertTrue(
            marker.is_file(),
            f"expected the marker {marker} in the python-source of maturin",
        )


if __name__ == "__main__":
    unittest.main()
