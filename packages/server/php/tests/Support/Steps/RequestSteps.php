<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\Request;
use Polyspec\Hyper\Tests\CaseReader;
use Polyspec\Hyper\Tests\Support\Bytes;
use Polyspec\Hyper\Tests\Support\Json;
use Polyspec\Hyper\UploadedFile;

/** HY-42.6, HY-113.2: the cases of contracts/request.json. */
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
        $case->compare('last', array_map(
            static fn (string $name): ?string => $request->file($name)?->filename(),
            Json::strings($case->input('names')),
        ));
        $case->compare('pairs', array_map(
            static fn (array $pair): array => [
                $pair[0],
                array_map(static fn (UploadedFile $file): string => $file->filename(), $pair[1]),
            ],
            $request->files(),
        ));
    }
}
