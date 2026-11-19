<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\Cookies;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Tests\CaseReader;
use Polyspec\Hyper\Tests\Support\Bytes;
use Polyspec\Hyper\Tests\Support\CaseRules;
use Polyspec\Hyper\Tests\Support\Json;
use Polyspec\Hyper\UploadedFile;

/** HY-11, HY-42, HY-56, HY-57, HY-97, HY-113.2, HY-116.16, HY-129: the cases of contracts/request.json. */
final class RequestSteps
{
    /**
     * Creates a request of the texts of the case and records the error of its creation, or null. A PHP string holds
     * bytes, so the text of the case becomes bytes first, which fails for a character above U+00FF.
     */
    public static function texts(CaseReader $case): void
    {
        $path = Json::string($case->input('path'));
        $query = Json::string($case->input('query'));
        $given = (array) $case->input('headers');
        $failure = null;
        try {
            $headers = [];
            foreach ($given as $name => $value) {
                $headers[Bytes::of((string) $name)] = Bytes::of(Json::string($value));
            }
            new Request('GET', Bytes::of($path), $headers, Bytes::of($query));
        } catch (\Throwable $error) {
            $failure = $error;
        }
        $case->outcome('request', $failure);
    }

    /** Reads the body of the case as a request and records the last file of each name and the pairs of the files. */
    public static function files(CaseReader $case): void
    {
        $request = new Request(
            'POST',
            '/',
            ['Content-Type' => Bytes::of(Json::string($case->input('type')))],
            '',
            Bytes::of(Json::string($case->input('body'))),
        );
        // `names` is optional: a case of a failing limit states no files (HY-114.12).
        if ($case->has('names')) {
            $case->compare('last', array_map(
                static fn (string $name): ?string => $request->file($name)?->filename(),
                Json::strings($case->input('names')),
            ));
        }
        $case->compare('pairs', array_map(
            static fn (array $pair): array => [
                $pair[0],
                array_map(static fn (UploadedFile $file): string => $file->filename(), $pair[1]),
            ],
            $request->files(),
        ));
        if ($case->has('limits')) {
            $limits = array_map(
                static fn (mixed $limit): int => Json::integer($limit, 'a limit of the case'),
                Json::list($case->input('limits')),
            );
            $outcome = CaseRules::failureOf(static fn (): array => array_map($request->fileOver(...), $limits));
            $case->compare('over', $outcome['result']);
            $case->compare('raises', $outcome['raises']);
        }
    }

    /**
     * Makes the file of the case with the constructor and compares its members, then moves it when the case names a
     * move and compares the failure of the move, the bytes at the path, and the failures of content() and of a second
     * move after it (HY-113.8, HY-131.28).
     */
    public static function uploads(CaseReader $case): void
    {
        $given = Json::map($case->input('file'), 'the case field file');
        $file = new UploadedFile(
            Bytes::of(Json::string($given['name'] ?? null)),
            Bytes::of(Json::string($given['filename'] ?? null)),
            Bytes::of(Json::string($given['contentType'] ?? null)),
            Bytes::of(Json::string($given['content'] ?? null)),
        );
        $case->compare('name', $file->name());
        $case->compare('contentType', $file->contentType());
        $case->compare('size', $file->size());
        $case->compare('content', Bytes::text($file->content()));
        if (!$case->has('move')) {
            return;
        }
        $directory = sys_get_temp_dir() . '/hyper-uploads-' . bin2hex(random_bytes(6));
        mkdir($directory);
        $path = "{$directory}/moved";
        try {
            $move = Json::string($case->input('move'));
            if ($move === 'existing') {
                file_put_contents($path, 'old bytes');
            } elseif ($move !== 'new') {
                throw new \UnexpectedValueException('the move of the case is neither new nor existing');
            }
            $outcome = CaseRules::failureOf(static fn () => $file->moveTo($path));
            $case->compare('raises', $outcome['raises']);
            if ($outcome['raises'] !== null) {
                return;
            }
            $case->compare('moved', Bytes::text((string) file_get_contents($path)));
            $case->compare('after', self::kindOf(static fn () => $file->content()));
            $case->compare('again', self::kindOf(static fn () => $file->moveTo("{$directory}/again")));
        } finally {
            foreach (['moved', 'again'] as $name) {
                if (is_file("{$directory}/{$name}")) {
                    unlink("{$directory}/{$name}");
                }
            }
            rmdir($directory);
        }
    }

    /**
     * The kind and the category of the failure of a call, without the status and the message that the case does not
     * state, or null when the call does not fail.
     *
     * @return array{kind: mixed, category: string}|null
     */
    private static function kindOf(callable $call): ?array
    {
        $raises = CaseRules::failureOf($call)['raises'];

        return $raises === null ? null : ['kind' => $raises['kind'], 'category' => $raises['category']];
    }

    /**
     * Creates a request whose path, raw query and headers are the UTF-8 bytes of the texts of the case and compares
     * its failure, or null: a PHP string holds bytes, so a character above U+00FF is its bytes (HY-42.7).
     */
    public static function bytes(CaseReader $case): void
    {
        $headers = [];
        foreach ((array) $case->input('headers') as $name => $value) {
            $headers[(string) $name] = Json::string($value);
        }
        $path = Json::string($case->input('path'));
        $query = Json::string($case->input('query'));
        $outcome = CaseRules::failureOf(static fn (): Request => new Request('GET', $path, $headers, $query));
        $case->compare('raises', $outcome['raises']);
    }

    /** Records the path and the raw query of a request target, whose characters are bytes (HY-42, HY-56). */
    public static function targets(CaseReader $case): void
    {
        $target = Bytes::of(Json::string($case->input('target')));
        $case->compare('path', Request::targetPath($target));
        $case->compare('query', Request::targetQuery($target));
    }

    /**
     * Builds the request of the case as a host does, copies it with the headers of `with`, and records what the
     * members of the copy return, and the headers of the request before the copies.
     */
    public static function values(CaseReader $case): void
    {
        $given = Json::array($case->input('request'));
        $target = Bytes::of(Json::string($given['target'] ?? null));
        $headers = [];
        $cookie = null;
        foreach ((array) ($given['headers'] ?? []) as $name => $value) {
            $headers[Bytes::of((string) $name)] = Bytes::of(Json::string($value));
            if (strtolower((string) $name) === 'cookie') {
                $cookie = Bytes::of(Json::string($value));
            }
        }
        if (array_key_exists('cookies', $given)) {
            $cookies = [];
            foreach ((array) $given['cookies'] as $name => $value) {
                $cookies[Bytes::of((string) $name)] = Bytes::of(Json::string($value));
            }
        } else {
            // HY-129.1: the one parse of the Cookie header.
            $cookies = Cookies::parse($cookie);
        }
        $original = new Request(
            Json::string($given['method'] ?? 'GET'),
            Request::targetPath($target),
            $headers,
            Request::targetQuery($target),
            Bytes::of(Json::string($given['body'] ?? '')),
            cookies: $cookies,
            https: ($given['https'] ?? false) === true,
        );
        if (array_key_exists('selection', $given)) {
            $original = $original->withSelection($given['selection']);
        }
        if (array_key_exists('media', $given)) {
            $original = $original->withMedia(Json::string($given['media']));
        }
        $request = $original;
        if ($case->has('with')) {
            foreach (Json::list($case->input('with')) as $pair) {
                [$name, $value] = Json::strings($pair);
                $request = $request->withHeader($name, $value);
            }
        }
        // A member that fails ends the comparison, and the failure is compared with `raises`.
        $outcome = CaseRules::failureOf(static fn () => self::members($case, $request, $original));
        $case->compare('raises', $outcome['raises']);
    }

    /** Compares the members of the copy of the request that the case states and the headers of the original. */
    private static function members(CaseReader $case, Request $request, Request $original): void
    {
        $case->compare('method', $request->method);
        $case->compare('path', $request->path());
        $case->compare('rawQuery', $request->rawQuery());
        $case->compare('mediaType', $request->mediaType());
        $case->compare('query', $request->query());
        if ($case->has('queryInt')) {
            $case->compare('queryInt', array_map(
                static function (mixed $pair) use ($request): int {
                    $pair = Json::list($pair);
                    if (!is_int($pair[1] ?? null)) {
                        throw new \UnexpectedValueException('a default of integers is not an integer');
                    }

                    return $request->queryInt(Json::string($pair[0] ?? null), $pair[1]);
                },
                Json::list($case->input('integers')),
            ));
        }
        $case->compare('form', $request->form());
        if ($case->has('formString')) {
            $names = Json::strings($case->input('formNames'));
            $case->compare('formString', array_map($request->formString(...), $names));
        }
        if ($case->has('cookie')) {
            $case->compare('cookie', array_map($request->cookie(...), Json::strings($case->input('cookieNames'))));
        }
        if ($case->has('header')) {
            $case->compare('header', array_map($request->header(...), Json::strings($case->input('headerNames'))));
        }
        if ($case->has('original.header')) {
            $names = Json::strings($case->input('headerNames'));
            $case->compare('original.header', array_map($original->header(...), $names));
        }
        $case->compare('https', $request->https);
        $case->compare('selection', $request->selection());
        $case->compare('valid', $request->validInput());
        $case->compare('bodySize', $request->bodySize());
        $case->compare('currentPath', $request->currentPath());
        if ($case->has('wantsJson')) {
            $case->compare('wantsJson', self::kind($request->wantsJson(...)));
        }
        if ($case->has('isRegionRequest')) {
            $case->compare('isRegionRequest', self::kind($request->isRegionRequest(...)));
        }
    }

    /**
     * Returns the result of a member that reads the selected media type, or the text `caller error` when it raises the
     * error of a request that holds none (HY-116.16).
     *
     * @param \Closure(): bool $member
     */
    private static function kind(\Closure $member): bool|string
    {
        try {
            return $member();
        } catch (\LogicException $error) {
            if (
                $error::class !== \LogicException::class
                || !str_contains($error->getMessage(), 'the request holds no selected media type')
            ) {
                throw $error;
            }

            return 'caller error';
        }
    }
}
