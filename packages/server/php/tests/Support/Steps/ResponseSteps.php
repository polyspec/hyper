<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\Response;
use Polyspec\Hyper\Tests\CaseReader;
use Polyspec\Hyper\Tests\Support\CaseInput;
use Polyspec\Hyper\Tests\Support\Json;
use Polyspec\Hyper\Tests\Support\Plain;

/** HY-106: the cases of contracts/response.json, the response that an application makes and copies. */
final class ResponseSteps
{
    /** Makes a response, copies it with each header of `with` and records the last copy and the first headers. */
    public static function values(CaseReader $case): void
    {
        $status = CaseInput::integer($case, 'status');
        $body = CaseInput::text($case, 'body');
        $make = CaseInput::text($case, 'make');
        $first = match ($make) {
            'constructor' => new Response(
                $status,
                $case->has('headers') ? self::pairs($case->input('headers')) : [],
                $body,
            ),
            'text' => Response::text($status, $body),
            default => throw new \UnexpectedValueException("the word {$make} of the case is unknown"),
        };
        $response = $first;
        foreach ($case->has('with') ? self::pairs($case->input('with'), true) : [] as [$name, $value]) {
            $response = $response->withHeader($name, $value);
        }
        $case->compare('response', [
            'status' => $response->status,
            'headers' => Plain::map($response->headers),
            'body' => $response->body,
        ]);
        $case->compare('original', Plain::map($first->headers));
    }

    /**
     * Returns the pairs of a name and a value of a case, as a map in their order or as the list of the pairs.
     *
     * @return ($list is true ? list<array{0: string, 1: string}> : array<string, string>)
     */
    private static function pairs(mixed $pairs, bool $list = false): array
    {
        $map = [];
        $items = [];
        foreach (Json::list($pairs) as $pair) {
            $pair = Json::strings($pair);
            if (count($pair) !== 2) {
                throw new \UnexpectedValueException('a header of the case is not a name and a value');
            }
            $map[$pair[0]] = $pair[1];
            $items[] = [$pair[0], $pair[1]];
        }

        return $list ? $items : $map;
    }
}
