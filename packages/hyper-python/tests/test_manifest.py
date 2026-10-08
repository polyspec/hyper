# The manifest of the PHP test fixtures and the rules that reject an invalid declaration (HY-1, HY-2, HY-37, HY-40,
# HY-49).
import json
import tempfile
import unittest
from pathlib import Path

from polyspec.hyper.manifest import Manifest

FIXTURES = Path(__file__).resolve().parents[2] / 'hyper-php' / 'tests' / 'fixtures'


def manifest(content: object) -> Manifest:
    """Reads a manifest from a value, as a file holds it; the file is removed after the read."""
    with tempfile.TemporaryDirectory() as directory:
        file = Path(directory) / 'app.json'
        file.write_text(json.dumps(content), encoding='utf-8')
        return Manifest.from_file(str(file))


BASE = {'layout': 'layout.tpl', 'title': 'title.tpl',
        'regions': [{'name': 'content', 'page': True}],
        'routes': [{'name': 'home', 'path': '/', 'title': 'Home', 'template': 'page.tpl'}]}


class ManifestTest(unittest.TestCase):
    def test_reads_the_fixtures_manifest(self) -> None:
        declared = Manifest.from_file(str(FIXTURES / 'app.json'))
        self.assertEqual(['side', 'content'], [region.name for region in declared.regions])
        self.assertEqual('content', declared.page.name)
        self.assertEqual(['home', 'add', 'item', 'list'], list(declared.routes))
        rows = declared.region('rows')
        self.assertEqual({'open': 'server', 'mode': 'cookie', 'view': 'localStorage', 'filter': 'cookie',
                          'tags': 'cookie'}, rows.keep)
        self.assertEqual(['open'], rows.kept_paths(['server']))

    def test_every_region_has_a_template_unless_it_is_the_page(self) -> None:
        with self.assertRaises(ValueError):
            manifest({**BASE, 'regions': [{'name': 'content', 'page': True, 'template': 'x.tpl'}]})
        with self.assertRaises(ValueError):
            manifest({**BASE, 'regions': [{'name': 'side', 'template': 'side.tpl'}]})

    def test_the_region_name_follows_hy_2(self) -> None:
        for name in ('1x', 'layout', 'title', 'data', 'a b'):
            with self.subTest(name):
                with self.assertRaises(ValueError):
                    manifest({**BASE, 'regions': [{'name': 'content', 'page': True}, {'name': name, 'template': 'x'}]})

    def test_a_manifest_region_cannot_keep_values(self) -> None:
        with self.assertRaises(ValueError):
            manifest({**BASE, 'regions': [{'name': 'content', 'page': True},
                                          {'name': 'side', 'template': 'x.tpl', 'uses': ['a'], 'keep': {'p': 'server'}}]})

    def test_exactly_one_page_region(self) -> None:
        with self.assertRaises(ValueError):
            manifest({**BASE, 'regions': [{'name': 'a', 'page': True}, {'name': 'b', 'page': True}]})
        with self.assertRaises(ValueError):
            manifest({**BASE, 'regions': [{'name': 'side', 'template': 'x.tpl'}]})

    def test_a_route_under_the_reserved_path_fails(self) -> None:
        with self.assertRaises(ValueError):
            manifest({**BASE, 'routes': [{**BASE['routes'][0], 'path': '/_hyper/keep'}]})

    def test_a_route_region_name_is_unique_across_every_region(self) -> None:
        with self.assertRaises(ValueError):
            manifest({**BASE, 'routes': [{'name': 'list', 'path': '/list', 'title': 'L', 'template': 'l.tpl',
                                          'regions': [{'name': 'content', 'template': 'r.tpl'}]}]})

    def test_an_invalid_kept_path_fails(self) -> None:
        with self.assertRaises(ValueError):
            manifest({**BASE, 'routes': [{'name': 'list', 'path': '/list', 'title': 'L', 'template': 'l.tpl',
                                          'regions': [{'name': 'rows', 'template': 'r.tpl',
                                                       'keep': {'a..b': 'server'}}]}]})


if __name__ == '__main__':
    unittest.main()
