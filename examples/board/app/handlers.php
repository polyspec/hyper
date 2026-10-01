<?php

declare(strict_types=1);

use Polyspec\Hyper\Examples\Board\Assets;
use Polyspec\Hyper\Examples\Board\Posts;
use Polyspec\Hyper\NotFound;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Result;

const POSTS_PER_PAGE = 10;

// Loaders and actions of the regions and routes that app.json declares.
return [
    'shared' => fn (Request $request, Assets $assets): array => [
        'csrf' => $request->csrfToken(),
        'assets' => $assets->urls(),
    ],

    'regions' => [
        'left' => fn (Request $request, Posts $posts): array => [
            'path' => $request->path(),
            'count' => $posts->count(),
        ],
    ],

    'routes' => [
        'board.list' => [
            'load' => function (Request $request, Posts $posts): array {
                $pages = max(1, $posts->pageCount(POSTS_PER_PAGE));
                $page = min($pages, max(1, $request->queryInt('page', 1)));

                return [
                    'posts' => $posts->page($page, POSTS_PER_PAGE),
                    'page' => $page,
                    'pages' => $pages,
                    'highlight' => $request->flash('created'),
                ];
            },
        ],

        'board.show' => [
            'load' => function (Request $request, Posts $posts): array {
                $id = (string) $request->param('id');
                $post = preg_match('/^[1-9]\d{0,15}$/D', $id) === 1 ? $posts->find((int) $id) : null;

                return ['post' => $post ?? throw new NotFound()];
            },
        ],

        'board.create' => [
            'post' => function (Request $request, Posts $posts): Result {
                $values = [
                    'title' => trim($request->formString('title')),
                    'author' => trim($request->formString('author')),
                    'body' => trim($request->formString('body')),
                ];
                $errors = array_filter([
                    'title' => match (true) {
                        $values['title'] === '' => '제목을 입력하세요.',
                        mb_strlen($values['title']) > 100 => '제목은 100자 이하로 입력하세요.',
                        default => null,
                    },
                    'author' => match (true) {
                        $values['author'] === '' => '작성자를 입력하세요.',
                        mb_strlen($values['author']) > 30 => '작성자는 30자 이하로 입력하세요.',
                        default => null,
                    },
                    'body' => $values['body'] === '' ? '내용을 입력하세요.' : null,
                ]);
                if ($errors !== []) {
                    return Result::invalid(['values' => $values, 'errors' => $errors]);
                }
                $id = $posts->create($values['title'], $values['author'], $values['body']);

                return Result::redirect('/board')->flash('created', $id)->changed('posts');
            },
        ],
    ],
];
