"""Loaders and actions of the regions and routes that app.json declares, as app/handlers.php defines them."""

from __future__ import annotations

import re

from polyspec.hyper.reply import Reply
from polyspec.hyper.request import Request
from polyspec.hyper.result import NotFound, Result

from posts import Posts

POSTS_PER_PAGE = 10

_ID = re.compile(r'[1-9][0-9]{0,15}\Z')
# The characters that PHP trim removes: space, tab, line feed, carriage return, NUL and vertical tab.
_TRIM = ' \t\n\r\x00\x0b'


class Services:
    """The services of the board: its posts and the URLs of its assets."""

    def __init__(self, posts: Posts, hyper: str):
        self.posts = posts
        self.hyper = hyper


def _current_page(request: Request, posts: Posts) -> tuple[int, int]:
    """Returns the requested page number limited to the existing pages, and the page count."""
    pages = max(1, posts.page_count(POSTS_PER_PAGE))
    return min(pages, max(1, request.query_int('page', 1))), pages


def _find_post(request: Request, posts: Posts) -> dict:
    """Returns the post of the route parameter `id`, or reports a missing resource."""
    identifier = request.param('id') or ''
    post = posts.find(int(identifier)) if _ID.fullmatch(identifier) is not None else None
    if post is None:
        raise NotFound()
    return post


def handlers(services: Services) -> dict:
    """Returns the handlers of the board, as app/handlers.php defines them."""

    def shared(request: Request) -> dict:
        # The post page, the one route with the parameter `id`, links the reader stylesheet (HY-64).
        return {'assets': {'hyper': services.hyper}, 'reader': request.param('id') is not None}

    def left(request: Request) -> dict:
        return {'path': request.path(), 'count': services.posts.count()}

    def list_load(request: Request) -> dict:
        page, pages = _current_page(request, services.posts)
        return {'page': page, 'pages': pages}

    def notice(request: Request) -> dict | None:
        # The notice is on the first page only; another page has no notice region (HY-75).
        if _current_page(request, services.posts)[0] != 1:
            return None
        return {'notice': {'text': '게시판 예제입니다. 정렬과 공지 닫기는 서버 요청 없이 처리됩니다.', 'closed': False}}

    def rows(request: Request) -> dict:
        page = _current_page(request, services.posts)[0]
        return {'posts': services.posts.page(page, POSTS_PER_PAGE), 'sort': '', 'compact': False,
                'highlight': request.flash('created')}

    def show_load(request: Request) -> dict:
        return {'post': _find_post(request, services.posts)}

    def reader(request: Request, reply: Reply) -> dict:
        # The post page embeds its data, so the reader changes without a request; the list embeds none and the
        # browser requests its data when it first changes a region (HY-31, HY-92).
        reply.embed_data()
        return {'post': _find_post(request, services.posts), 'large': False}

    def create(request: Request) -> Result:
        values = {name: request.form_string(name).strip(_TRIM) for name in ('title', 'author', 'body')}
        errors = {}
        if values['title'] == '':
            errors['title'] = '제목을 입력하세요.'
        elif len(values['title']) > 100:
            errors['title'] = '제목은 100자 이하로 입력하세요.'
        if values['author'] == '':
            errors['author'] = '작성자를 입력하세요.'
        elif len(values['author']) > 30:
            errors['author'] = '작성자는 30자 이하로 입력하세요.'
        if values['body'] == '':
            errors['body'] = '내용을 입력하세요.'
        if errors != {}:
            return Result.invalid({'values': values, 'errors': errors})
        identifier = services.posts.create(values['title'], values['author'], values['body'])
        return Result.redirect('/board').flash_value('created', identifier).changed('posts')

    return {
        'shared': shared,
        'regions': {'left': left},
        'routes': {
            'board.list': {'load': list_load, 'regions': {'notice': notice, 'rows': rows}},
            'board.show': {'load': show_load, 'regions': {'reader': reader}},
            'board.create': {'post': create},
        },
    }
