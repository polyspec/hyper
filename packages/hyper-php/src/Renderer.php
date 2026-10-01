<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

use Polyspec\Template\Native\Engine as NativeEngine;

/**
 * Renders documents and single regions with the compiled program of the application: the native template
 * extension when PHP has loaded it, and otherwise the generated PHP program (HY-12, HY-13, HY-30, HY-31, HY-48).
 */
final class Renderer
{
    public const DATA_NAME = 'hyper/data.tpl';

    private function __construct(private readonly object $program, public readonly string $engine, private readonly string $timezone)
    {
    }

    /** Opens the program that `scripts/build-server.mjs` wrote to a directory. */
    public static function open(string $program, string $timezone): self
    {
        if (!is_file("{$program}/program.php") || !is_file("{$program}/program.json") || !is_dir("{$program}/templates")) {
            throw new \InvalidArgumentException("{$program} is not a server program built by scripts/build-server.mjs");
        }
        if (extension_loaded('polyspec_template')) {
            return new self(new NativeEngine("{$program}/templates"), 'native', $timezone);
        }
        // The generated program is declared in the namespace that the build chose (HY-48).
        $namespace = json_decode((string) file_get_contents("{$program}/program.json"), true, flags: JSON_THROW_ON_ERROR)['namespace'];
        require_once "{$program}/program.php";
        $class = "\\{$namespace}\\GeneratedProgram";

        return new self(new $class(), 'generated', $timezone);
    }

    /**
     * Renders the document: the layout with the title, the embedded data and every manifest region rendered
     * alone as HTML definitions; the page region receives its route regions the same way.
     *
     * @param array<string, mixed> $shared
     * @param array<string, array{template: string, data: array<string, mixed>}> $regions manifest regions
     * @param array<string, array{template: string, data: array<string, mixed>}> $routeRegions route regions of the page region
     * @param array<string, mixed>|\stdClass $response the document JSON value embedded by `{# data}`
     */
    public function document(string $layout, string $title, array $shared, array $regions, string $page, array $routeRegions, array|\stdClass $response): string
    {
        $define = [
            'title' => ['html' => $this->render($title, $shared, [])],
            'data' => ['html' => $this->render(self::DATA_NAME, ['response' => $response], [])],
        ];
        foreach ($regions as $name => $region) {
            $define[$name] = ['html' => $this->alone($region['template'], $shared, $region['data'], $name === $page ? $routeRegions : [])];
        }

        return $this->render($layout, $shared, $define);
    }

    /**
     * Renders one template alone with merge(shared, data) as root data; `$routeRegions` passes the route
     * regions of a page region, each rendered alone, as HTML definitions.
     *
     * @param array<string, mixed> $shared
     * @param array<string, mixed> $data
     * @param array<string, array{template: string, data: array<string, mixed>}> $routeRegions
     */
    public function alone(string $template, array $shared, array $data, array $routeRegions = []): string
    {
        $define = [];
        foreach ($routeRegions as $name => $region) {
            $define[$name] = ['html' => $this->alone($region['template'], $shared, $region['data'])];
        }

        return $this->render($template, array_replace($shared, $data), $define);
    }

    /**
     * @param array<string, mixed> $assign
     * @param array<string, array{html: string}> $define
     */
    private function render(string $template, array $assign, array $define): string
    {
        $options = ['env' => ['timezone' => $this->timezone]];
        if ($define !== []) {
            $options['define'] = $define;
        }

        return $this->program->render($template, $assign, $options);
    }
}
