<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\App;
use Polyspec\Hyper\ArraySession;
use Polyspec\Hyper\Program;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Tests\CaseReader;
use Polyspec\Hyper\Tests\Support\CaseInput;

/**
 * HY-73: the cases of contracts/reads.json. Each case is the application `reads_<id>` that
 * scripts/contract-programs.mts builds from the templates of the case, whose route `reads` renders the template of the
 * case in its page region `content`. The PHP server keeps the read paths with the core: the region data of the JSON
 * response of a loader that returns the data of the case is the kept data, and the render of the template with the
 * kept data and with the data gives the same bytes (HY-73.28).
 */
final class ReadsSteps
{
    private const PROGRAMS = __DIR__ . '/../../../../../var/contract-programs';

    public static function cases(CaseReader $case): void
    {
        $data = self::root($case->input('data'));
        $templates = (array) $case->input('templates');
        $template = CaseInput::text($case, 'template');
        if (!array_key_exists($template, $templates)) {
            throw new \LogicException("the template {$template} is not among the templates of {$case->id()}");
        }
        $directory = self::PROGRAMS . '/reads_' . $case->id();
        // HY-73.34: the build wrote the read paths of the template of the case, the page region of the route `reads`
        // of the application, to reads.json of the program that the server opens.
        $file = "{$directory}/program/reads.json";
        $json = file_get_contents($file);
        if ($json === false) {
            throw new \RuntimeException("{$file} cannot be read");
        }
        // The read paths are the member routes.reads.regions.content of the file; a member that is missing, or whose
        // holder is no object, gives null, which the comparison reports.
        $paths = json_decode($json, false, 512, JSON_THROW_ON_ERROR);
        foreach (['routes', 'reads', 'regions', 'content'] as $member) {
            $paths = $paths instanceof \stdClass ? ($paths->{$member} ?? null) : null;
        }
        // The input `reads` is the paths that the core keeps; the core takes them from that file, which is compared
        // with it, so the step reads it only through the comparison.
        $case->input('reads');
        $case->compare('reads', $paths);

        $app = App::open(
            "{$directory}/manifest.json",
            "{$directory}/program",
            ['routes' => ['reads' => ['load' => static fn (): array => $data]]],
            'Z',
        );
        $response = $app->handle(
            new Request('GET', '/', ['Accept' => 'application/vnd.hyper+json']),
            new ArraySession(),
        );
        if ($response->status !== 200) {
            throw new \UnexpectedValueException("the JSON response of the case has status {$response->status}");
        }
        $value = json_decode($response->body, false, 512, JSON_THROW_ON_ERROR);
        $regions = $value instanceof \stdClass && $value->regions instanceof \stdClass ? $value->regions : null;
        $kept = $regions->content ?? throw new \UnexpectedValueException('the JSON response has no region content');
        $case->compare('kept', $kept);

        $pages = Program::pages(
            "{$directory}/manifest.json",
            "{$directory}/program",
            'Z',
            false,
            '',
            ['application/x-www-form-urlencoded'],
            null,
            [],
        );
        $text = self::alone($pages, $data);
        $case->outcome('render', self::alone($pages, self::root($kept)), $text);
        $case->compare('text', $text);
    }

    /**
     * Renders the template of the case alone with the data, as the page region of the route `reads`.
     *
     * @param array<array-key, mixed> $data
     */
    private static function alone(\Polyspec\Hyper\Pages $pages, array $data): string
    {
        $regions = (array) $pages->renderParts('reads', [], ['content' => $data], 0.0)->regions;
        $part = $regions['content'] ?? null;

        return is_string($part) ? $part : throw new \UnexpectedValueException('the region content has no part');
    }

    /**
     * Returns the data of a case, a map, as the array that a loader returns; its values keep their form.
     *
     * @return array<array-key, mixed>
     */
    private static function root(mixed $value): array
    {
        return match (true) {
            is_array($value) => $value,
            $value instanceof \stdClass => get_object_vars($value),
            default => throw new \UnexpectedValueException('the data of the case is no map'),
        };
    }
}
