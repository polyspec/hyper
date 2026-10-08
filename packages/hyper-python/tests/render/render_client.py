# The client rendering of the conformance cases (HY-62). The PHP and the Node server pass the same cases of
# conformance/client.json against the same fixtures.
import json
import unittest
from pathlib import Path
from urllib.parse import urlencode

from polyspec.hyper.app import App
from polyspec.hyper.client import Choice, ClientRendering
from polyspec.hyper.csrf import masked
from polyspec.hyper.request import Request
from polyspec.hyper.result import Result
from polyspec.hyper.session import ArraySession

TESTS = Path(__file__).resolve().parents[2]
FIXTURES = TESTS.parent / 'hyper-php' / 'tests' / 'fixtures'
PROGRAM = FIXTURES.parent / 'build' / 'server'
SHELL = FIXTURES / 'shell' / 'index.html'
CONFORMANCE = Path(__file__).resolve().parents[4] / 'conformance'
# A session token of HY-24; the form carries a masked value of it.
TOKEN = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'


class Counter:
    """A service that the fixture application reads and changes."""

    def __init__(self):
        self.count = 0
        self.actions = 0


def conformance() -> dict:
    return json.loads((CONFORMANCE / 'client.json').read_text(encoding='utf-8'))


def _handlers() -> dict:
    def add(request: Request, counter: Counter) -> Result:
        counter.actions += 1
        if request.form_string('name') == 'taken':
            return Result.page(409, {'name': 'taken', 'error': 'conflict'})
        counter.count += 1
        return Result.redirect('/')

    def side(counter: Counter) -> dict:
        return {'count': counter.count, 'note': None}

    def home_load(counter: Counter) -> dict:
        return {'name': f'n{counter.count}'}

    def rows() -> dict:
        return {'items': [], 'open': False, 'mode': 'a', 'view': 'x', 'filter': {'a': 1}, 'tags': []}

    return {
        'regions': {'side': side},
        'routes': {
            'home': {'load': home_load},
            'add': {'post': add},
            'list': {'regions': {'rows': rows}},
            'item': {'load': lambda request: {'id': request.param('id')}},
        },
    }


def app(counter: Counter, client: ClientRendering | None = None, **options) -> App:
    fixture = conformance()
    if client is None:
        client = ClientRendering(str(SHELL), fixture['basePath'],
                                  lambda request: Choice(request.header('Host') == fixture['chosenHost'], None))
    application = App.open(manifest=str(FIXTURES / 'app.json'), program=str(PROGRAM), handlers=_handlers(),
                           timezone='+09:00', client_rendering=client, **options)
    application.bind(Counter, lambda: counter)
    return application


class ClientConformanceTest(unittest.TestCase):
    def test_every_case(self) -> None:
        for case in conformance()['cases']:
            with self.subTest(case['label']):
                self._check(case)

    def _check(self, case: dict) -> None:
        counter = Counter()
        session = ArraySession()
        spec = case['request']
        form = {name: str(value) for name, value in (spec.get('form') or {}).items()}
        if spec.get('csrf'):
            session.set('_hyper_csrf', TOKEN)
            form = {'_csrf': masked(TOKEN), **form}
        headers = {name: str(value) for name, value in (spec.get('headers') or {}).items()}
        body = ''
        if form or 'form' in spec:
            headers['Content-Type'] = 'application/x-www-form-urlencoded'
            body = urlencode(form)
        target = spec['target']
        question = target.find('?')
        query = '' if question < 0 else target[question + 1:]
        path = target if question < 0 else target[:question]
        request = Request(spec['method'], path, headers, query, body.encode('utf-8'))
        response = app(counter).handle(request, session)

        self.assertEqual(case['status'], response.status)
        for name, value in case['headers'].items():
            self.assertEqual(value, response.headers.get(name), name)
        if case.get('shell'):
            self.assertEqual(SHELL.read_text(encoding='utf-8'), response.body)
            self.assertEqual(case['headers'], response.headers)
        if 'body' in case:
            self.assertEqual(case['body'], response.body)
        if 'json' in case:
            answered = json.loads(response.body)
            self.assertEqual(case['json']['route'], answered.get('route'))
            self.assertEqual(case['json']['params'], answered.get('params'))
            self.assertEqual(case['json']['regions'], list(answered.get('regions', {})))
        if case.get('session') is False:
            self.assertIsNone(session.get('_hyper_csrf'))
        self.assertEqual(case['actions'], counter.actions)


class SelectionTest(unittest.TestCase):
    def test_every_handler_of_a_request_reads_the_value_of_the_choice(self) -> None:
        # HY-62: the selection runs once per request, and its value reaches the shared handler, the loaders and the
        # action of the request, whether the selection chose the request or not.
        selections = []
        seen = []

        def selects(request: Request) -> Choice:
            selections.append(request.header('Host'))
            return Choice(request.header('Host') == 'client.test', {'host': request.header('Host')})

        def shared(request: Request) -> dict:
            seen.append(('shared', request.selection()))
            return {}

        def side(request: Request) -> dict:
            seen.append(('side', request.selection()))
            return {'count': 0, 'note': None}

        def item_load(request: Request) -> dict:
            seen.append(('item', request.selection()))
            return {'id': request.param('id')}

        def add(request: Request) -> Result:
            seen.append(('add', request.selection()))
            return Result.redirect('/')

        application = App.open(manifest=str(FIXTURES / 'app.json'), program=str(PROGRAM), handlers={
            'shared': shared,
            'regions': {'side': side},
            'routes': {'item': {'load': item_load}, 'add': {'post': add}},
        }, timezone='+09:00',
            client_rendering=ClientRendering(str(SHELL), '/_props', selects))
        application.handle(Request('GET', '/items/7', {'Host': 'server.test'}), ArraySession())
        self.assertEqual(['server.test'], selections)
        self.assertEqual([('shared', {'host': 'server.test'}), ('side', {'host': 'server.test'}),
                          ('item', {'host': 'server.test'})], seen)
        seen.clear()
        application.handle(Request('GET', '/_props/items/7', {'Host': 'client.test',
                                                              'Accept': 'application/json'}), ArraySession())
        self.assertEqual(['server.test', 'client.test'], selections)
        self.assertEqual([('shared', {'host': 'client.test'}), ('side', {'host': 'client.test'}),
                          ('item', {'host': 'client.test'})], seen)

    def test_a_selection_that_fails_answers_500(self) -> None:
        # HY-43, HY-62
        for selects in (lambda request: 'csr', lambda request: True,
                        lambda request: (_ for _ in ()).throw(RuntimeError('selection'))):
            with self.subTest(selects):
                application = app(Counter(), ClientRendering(str(SHELL), '/_props', selects))
                response = application.handle(Request('GET', '/'), ArraySession())
                self.assertEqual(500, response.status)
                self.assertEqual('Internal Server Error', response.body)

    def test_an_invalid_declaration_fails_when_the_application_opens(self) -> None:
        # HY-62
        selects = lambda request: Choice(True, None)  # noqa: E731
        invalid = [
            ('relative shell', ClientRendering('tests/fixtures/shell/index.html', '/_props', selects)),
            ('missing shell', ClientRendering(str(FIXTURES / 'shell' / 'missing.html'), '/_props', selects)),
            ('shell of another base path', ClientRendering(str(FIXTURES / 'shell' / 'other-base.html'),
                                                           '/_props', selects)),
            ('empty base path', ClientRendering(str(SHELL), '', selects)),
            ('base path ending with /', ClientRendering(str(SHELL), '/_props/', selects)),
            ('route under the base path', ClientRendering(str(SHELL), '/items', selects)),
        ]
        for label, client in invalid:
            with self.subTest(label):
                with self.assertRaises(ValueError):
                    app(Counter(), client)


if __name__ == '__main__':
    unittest.main()
