# The package data of `pyproject.toml` (H15.3-15): every key names a package under `src`, and the namespace package
# `polyspec.hyper` declares its `py.typed` marker, so a built package carries the marker.
import tomllib
import unittest
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[2]
SRC = PACKAGE / 'src'


class PackageDataTest(unittest.TestCase):
    def package_data(self) -> dict:
        with (PACKAGE / 'pyproject.toml').open('rb') as file:
            declared = tomllib.load(file)
        return declared.get('tool', {}).get('setuptools', {}).get('package-data', {})

    def test_every_key_names_a_package_under_src(self) -> None:
        for key in self.package_data():
            directory = SRC / key.replace('.', '/')
            self.assertTrue(directory.is_dir(),
                            f'package-data key {key!r} names no package directory: expected {directory} to exist')

    def test_namespace_package_declares_py_typed(self) -> None:
        entries = self.package_data().get('polyspec.hyper', [])
        self.assertIn('py.typed', entries,
                      f'package-data of polyspec.hyper: expected an entry "py.typed", actual {entries!r}')
        self.assertTrue((SRC / 'polyspec' / 'hyper' / 'py.typed').is_file(),
                        'expected the marker src/polyspec/hyper/py.typed to exist')


if __name__ == '__main__':
    unittest.main()
