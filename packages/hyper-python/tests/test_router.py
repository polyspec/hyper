# Router matching of the conformance cases (HY-4 to HY-8, HY-49). The PHP and the JavaScript router pass the same
# cases of conformance/routes.json and conformance/rest.json.
import json
import unittest
from pathlib import Path

from polyspec.hyper.router import Router, strip_base_path

CONFORMANCE = Path(__file__).resolve().parents[3] / 'conformance'


def file(name: str) -> dict:
    return json.loads((CONFORMANCE / name).read_text(encoding='utf-8'))


class RoutesTest(unittest.TestCase):
    def test_every_case(self) -> None:
        fixture = file('routes.json')
        router = Router(fixture['routes'])
        for case in fixture['cases']:
            with self.subTest(case['path']):
                self.assertEqual(case['result'], router.match(case['path']))

    def test_every_case_under_the_base_path(self) -> None:
        fixture = file('routes.json')
        router = Router(fixture['routes'])
        for case in fixture['baseCases']:
            with self.subTest(case['path']):
                path = strip_base_path(case['path'], fixture['basePath'])
                self.assertEqual(case['result'], None if path is None else router.match(path))

    def test_every_invalid_path_fails(self) -> None:
        for path in file('routes.json')['invalidPaths']:
            with self.subTest(path):
                with self.assertRaises(ValueError):
                    Router([{'name': 'x', 'path': path}])


class RestTest(unittest.TestCase):
    def test_every_case(self) -> None:
        fixture = file('rest.json')
        router = Router(fixture['routes'])
        for case in fixture['cases']:
            with self.subTest(case['path']):
                self.assertEqual(case['result'], router.match(case['path']))

    def test_every_invalid_path_fails(self) -> None:
        for path in file('rest.json')['invalidPaths']:
            with self.subTest(path):
                with self.assertRaises(ValueError):
                    Router([{'name': 'x', 'path': path}])


if __name__ == '__main__':
    unittest.main()
