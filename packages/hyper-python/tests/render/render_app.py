# The application answers document requests, JSON requests, region requests and actions with the rules of the PHP
# server (HY-15 to HY-19, HY-24 to HY-26, HY-40, HY-50 to HY-53, HY-58, HY-69, HY-73, HY-92).
import json
import unittest
from pathlib import Path
from urllib.parse import urlencode

from polyspec.hyper.app import App
from polyspec.hyper.csrf import masked
from polyspec.hyper.reply import Reply
from polyspec.hyper.request import Request
from polyspec.hyper.result import Result
from polyspec.hyper.session import ArraySession

TESTS = Path(__file__).resolve().parents[2]
FIXTURES = TESTS.parent / 'hyper-php' / 'tests' / 'fixtures'
PROGRAM = FIXTURES.parent / 'build' / 'server'
TOKEN = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'


def handlers() -> dict:
    def add(request: Request) -> Result:
        if request.form_string('name') == 'taken':
            return Result.page(409, {'name': 'taken'})
        return Result.redirect('/list').flash_value('created', 3).changed('rows')

    return {
        'shared': lambda request: {'site': 'fixture'},
        'regions': {'side': lambda request: {'count': 2}},
        'routes': {
            'home': {'load': lambda request: {'name': 'n'}},
            'add': {'post': add},
            'item': {'load': lambda request: {'id': request.param('id')}},
            'list': {
                'load': lambda request: {'rows': 2},
                'regions': {'rows': lambda request: {'posts': [{'title': 'a'}], 'sort': '', 'compact': False,
                                                     'open': False, 'highlight': request.flash('created')}},
            },
        },
    }


def opened(**options) -> App:
    return App.open(manifest=str(FIXTURES / 'app.json'), program=str(PROGRAM), handlers=handlers(),
                    timezone='+09:00', **options)


def get(path: str, headers: dict | None = None, query: str = '', body: bytes = b'') -> Request:
    return Request('GET', path, headers or {}, query, body)


class PageTest(unittest.TestCase):
    def test_a_document_request_receives_the_document_html(self) -> None:
        response = opened().handle(get('/', {'Accept': 'application/json'}), ArraySession())
        self.assertEqual(200, response.status)
        self.assertEqual('application/json; charset=utf-8', response.headers['Content-Type'])
        answered = json.loads(response.body)
        self.assertEqual('home', answered['route'])
        self.assertEqual(['side', 'content'], list(answered['regions']))
        self.assertEqual('Home', answered['shared']['title'])
        self.assertEqual({}, answered['kept'])

    def test_a_region_request_receives_the_page_and_the_changed_regions(self) -> None:
        store = ArraySession()
        app = opened()
        first = app.handle(get('/list', {'Accept': 'application/json'}), store)
        # The action of the next request stores the changed topic `rows`; the region request selects the regions
        # that use it.
        app.handle(Request('POST', '/add', {'Accept': 'application/json',
                                            'Content-Type': 'application/x-www-form-urlencoded',
                                            'HX-Request': 'true'},
                           body=urlencode({'_csrf': masked(_token(app, store)), 'name': 'ok'}).encode()),
                   store)
        response = app.handle(get('/list', {'Accept': 'application/json', 'HX-Request': 'true',
                                            'HX-Current-URL': 'http://host.example/list'}), store)
        answered = json.loads(response.body)
        self.assertEqual(['content', 'rows'], list(answered['regions']))

    def test_an_html_request_receives_a_document(self) -> None:
        response = opened().handle(get('/items/7'), ArraySession())
        self.assertEqual(200, response.status)
        self.assertEqual('text/html; charset=utf-8', response.headers['Content-Type'])
        self.assertIn('no-store', response.headers['Cache-Control'])
        self.assertIn('Item', response.body)

    def test_the_embedded_data_of_a_document_that_the_reply_asks_for(self) -> None:
        app = opened()
        seen: list[bool] = []

        def shared_loader(request: Request, reply: Reply) -> dict:
            if request.path() == '/list':
                reply.embed_data()
                seen.append(True)
            return {'site': 'fixture'}

        app_with_embed = App.open(manifest=str(FIXTURES / 'app.json'), program=str(PROGRAM),
                                  handlers={**handlers(), 'shared': shared_loader}, timezone='+09:00')
        document = app_with_embed.handle(get('/list'), ArraySession()).body
        self.assertEqual([True], seen)
        self.assertIn('id="hy-data"', document)
        self.assertNotIn('id="hy-data"', app.handle(get('/list'), ArraySession()).body)

    def test_a_page_without_a_present_route_region_embeds_no_data(self) -> None:
        def shared_loader(request: Request, reply: Reply) -> dict:
            reply.embed_data()
            return {}

        app = App.open(manifest=str(FIXTURES / 'app.json'), program=str(PROGRAM),
                       handlers={**handlers(), 'shared': shared_loader}, timezone='+09:00')
        self.assertNotIn('id="hy-data"', app.handle(get('/'), ArraySession()).body)


class ActionTest(unittest.TestCase):
    def test_an_action_that_succeeds_redirects(self) -> None:
        store = ArraySession()
        app = opened()
        response = app.handle(Request('POST', '/add', {'Content-Type': 'application/x-www-form-urlencoded'},
                                      body=urlencode({'_csrf': masked(_token(app, store)), 'name': 'ok'}).encode()),
                              store)
        self.assertEqual(303, response.status)
        self.assertEqual('/list', response.headers['Location'])

    def test_an_action_without_a_csrf_token_is_forbidden(self) -> None:
        response = opened().handle(Request('POST', '/add', {'Content-Type': 'application/x-www-form-urlencoded'},
                                           body=b'name=ok'), ArraySession())
        self.assertEqual(403, response.status)
        self.assertEqual('Forbidden', response.body)

    def test_an_action_result_page_with_status_409(self) -> None:
        store = ArraySession()
        app = opened()
        response = app.handle(
            Request('POST', '/add', {'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json'},
                    body=urlencode({'_csrf': masked(_token(app, store)), 'name': 'taken'}).encode()), store)
        self.assertEqual(409, response.status)
        answered = json.loads(response.body)
        self.assertEqual('add', answered['route'])
        self.assertEqual('taken', answered['regions']['content']['name'])

    def test_the_etag_of_a_json_page_and_the_304_of_a_matching_request(self) -> None:
        store = ArraySession()
        app = opened()
        first = app.handle(get('/list', {'Accept': 'application/json'}), store)
        tag = first.headers['ETag']
        self.assertTrue(tag.startswith('W/"'))
        again = app.handle(get('/list', {'Accept': 'application/json', 'If-None-Match': tag}), store)
        self.assertEqual(304, again.status)
        self.assertNotIn('Content-Type', again.headers)
        self.assertEqual('', again.body)

    def test_the_reply_gives_a_page_the_status_403(self) -> None:
        def shared_loader(request: Request, reply: Reply) -> dict:
            reply.status(403)
            return {}

        app = App.open(manifest=str(FIXTURES / 'app.json'), program=str(PROGRAM),
                       handlers={**handlers(), 'shared': shared_loader}, timezone='+09:00')
        response = app.handle(get('/', {'Accept': 'application/json'}), ArraySession())
        self.assertEqual(403, response.status)
        self.assertEqual('no-store', response.headers['Cache-Control'])


class KeepTest(unittest.TestCase):
    def test_a_conforming_kept_value_replaces_its_path(self) -> None:
        store = ArraySession()
        store.set('_hyper_keep', {'rows': {'open': True}})
        response = opened().handle(get('/list', {'Accept': 'application/json'}), store)
        answered = json.loads(response.body)
        self.assertEqual({'open': True}, answered['kept']['rows'])
        self.assertEqual(True, answered['kept']['rows']['open'])

    def test_the_keep_endpoint_stores_a_server_value(self) -> None:
        store = ArraySession()
        app = opened()
        token = _token(app, store)
        response = app.handle(Request('POST', '/_hyper/keep', {'Content-Type': 'application/x-www-form-urlencoded'},
                                      body=urlencode({'_csrf': masked(token), 'region': 'rows', 'path': 'open',
                                                      'value': 'true'}).encode()), store)
        self.assertEqual(204, response.status)
        self.assertEqual({'open': True}, session_kept(store))

    def test_the_keep_endpoint_rejects_a_path_that_is_not_server(self) -> None:
        store = ArraySession()
        app = opened()
        token = _token(app, store)
        response = app.handle(
            Request('POST', '/_hyper/keep', {'Content-Type': 'application/x-www-form-urlencoded'},
                    body=urlencode({'_csrf': masked(token), 'region': 'rows', 'path': 'view',
                                    'value': '"x"'}).encode()), store)
        self.assertEqual(400, response.status)


class ProgramTest(unittest.TestCase):
    def test_a_missing_program_names_the_missing_file(self) -> None:
        # HY-48: a missing build fails when the application opens and names the missing file.
        empty = Path(__import__('tempfile').mkdtemp())
        with self.assertRaises(ValueError) as missing:
            App.open(manifest=str(FIXTURES / 'app.json'), program=str(empty), handlers=handlers(),
                     timezone='+09:00')
        self.assertIn('reads.json', str(missing.exception))
        (empty / 'reads.json').write_text('{"routes": {}}', encoding='utf-8')
        with self.assertRaises(ValueError) as missing:
            App.open(manifest=str(FIXTURES / 'app.json'), program=str(empty), handlers=handlers(),
                     timezone='+09:00')
        self.assertIn('templates', str(missing.exception))


def _token(app: App, store: ArraySession) -> str:
    from polyspec.hyper.session import Session
    return Session(store).csrf_token()


def session_kept(store: ArraySession) -> dict:
    from polyspec.hyper.session import Session
    return Session(store).kept('rows')


if __name__ == '__main__':
    unittest.main()
