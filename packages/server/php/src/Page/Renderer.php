<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

use Polyspec\Template\BoundMap;
use Polyspec\Template\Program;
use Polyspec\Template\Render\RuntimeEnvironment;

/**
 * Renders documents and single regions with the generated PHP program of the application, through the API of the
 * template package that the template extension registers under the same names (HY-12, HY-13, HY-30, HY-31,
 * HY-48).
 * The caller binds each root of a document once with `bind`, and every render merges the bound roots, so the
 * renders of a document check no value again (HY-13, VAL-22).
 *
 * @internal
 */
final class Renderer
{
    public const DATA_NAME = 'hyper/data.tpl';

    private function __construct(
        private readonly Program $program,
        private readonly string $timezone,
    ) {
    }

    /**
     * Opens the program that `hyper-build-server` of `@polyspec/hyper-build` wrote to a directory.
     *
     * @param array<string, callable(): mixed> $functions the host functions of the application (HYC-24)
     */
    public static function open(string $program, string $timezone, array $functions = []): self
    {
        // A missing build fails here and names the missing file (HY-48).
        $required = [
            "{$program}/php" => is_dir(...),
            "{$program}/program.json" => is_file(...),
            "{$program}/reads.json" => is_file(...),
            "{$program}/build.json" => is_file(...),
            "{$program}/templates" => is_dir(...),
        ];
        foreach ($required as $path => $exists) {
            if (!$exists($path)) {
                throw new \InvalidArgumentException(
                    "{$path} of the server program {$program} is missing; "
                    . 'hyper-build-server of @polyspec/hyper-build builds it',
                );
            }
        }
        return new self(self::program($program, $functions), $timezone);
    }

    /**
     * Loads the generated program of a program directory (HY-48.7): the PSR-4 files of the namespace that the build
     * chose, in the directory php, which the autoload of Composer loads through autoload.psr-4 of the application. A
     * class that the autoload does not load fails with the class and the directory php (HY-48.9).
     *
     * @param array<string, callable(): mixed> $functions the host functions of the application (HYC-24)
     */
    private static function program(string $program, array $functions): Program
    {
        try {
            $text = (string) file_get_contents("{$program}/program.json");
            $declaration = json_decode($text, true, flags: JSON_THROW_ON_ERROR);
        } catch (\JsonException $error) {
            throw new \InvalidArgumentException("{$program}/program.json is not valid JSON or UTF-8", 0, $error);
        }
        $namespace = is_array($declaration) ? $declaration['namespace'] ?? null : null;
        if (!is_string($namespace)) {
            throw new \InvalidArgumentException("{$program}/program.json names no namespace");
        }
        $class = "{$namespace}\\GeneratedProgram";
        if (!class_exists($class)) {
            throw new \InvalidArgumentException(
                "the autoload loads no class {$class} of the server program {$program}; "
                . "map the namespace {$namespace} to {$program}/php in autoload.psr-4 of composer.json",
            );
        }
        // HYC-24, RT-5: the host functions of the application are registered by the engine, which fails the open of a
        // name that is built in or an entry that is not a function.
        $generated = new $class(new RuntimeEnvironment(hostFunctions: $functions));
        if (!$generated instanceof Program) {
            throw new \InvalidArgumentException("{$class} of the server program {$program} is not a template program");
        }

        return $generated;
    }

    /**
     * Binds a root of the data of a document once, with the bound map of the template package (VAL-22).
     *
     * @param array<array-key, mixed>|\stdClass $value
     */
    public function bind(array|\stdClass $value): BoundMap
    {
        return BoundMap::bind($value);
    }

    /**
     * Renders the document: the layout with the title, the embedded data and every manifest region rendered
     * alone as HTML definitions; the page region receives its route regions the same way.
     *
     * @param array<string, array{template: string, data: BoundMap}> $regions manifest regions
     * @param array<string, array{template: string, data: BoundMap}> $routeRegions route regions of the
     *     page region
     * @param BoundMap|null $data the bound root of `{# data}`, the map with the member `response`
     *     (HY-31), or null when the document embeds no data (HY-92)
     * @param string $build the build id of the application, which the definition `build` holds as a meta element
     *     (HY-125)
     */
    public function document(
        string $layout,
        string $title,
        BoundMap $shared,
        array $regions,
        string $page,
        array $routeRegions,
        BoundMap|null $data,
        string $build,
    ): string {
        $define = [
            'build' => ['html' => '<meta name="hyper-build" content="' . $build . '">'],
            'title' => ['html' => $this->render($title, $shared, [])],
            'data' => ['html' => $data === null ? '' : $this->render(self::DATA_NAME, $data, [])],
        ];
        foreach ($regions as $name => $region) {
            $define[$name] = [
                'html' => $this->alone(
                    $region['template'],
                    $shared,
                    $region['data'],
                    $name === $page ? $routeRegions : [],
                ),
            ];
        }

        return $this->render($layout, $shared, $define);
    }

    /**
     * Renders one template alone with merge(shared, data) as root data; `$routeRegions` passes the route
     * regions of a page region, each rendered alone, as HTML definitions.
     *
     * @param array<string, array{template: string, data: BoundMap}> $routeRegions
     */
    public function alone(
        string $template,
        BoundMap $shared,
        BoundMap $data,
        array $routeRegions = [],
    ): string {
        $define = [];
        foreach ($routeRegions as $name => $region) {
            $define[$name] = ['html' => $this->alone($region['template'], $shared, $region['data'])];
        }

        return $this->render($template, BoundMap::merge($shared, $data), $define);
    }

    /** @param array<string, array{html: string}> $define */
    private function render(string $template, BoundMap $assign, array $define): string
    {
        $options = ['env' => ['timezone' => $this->timezone]];
        if ($define !== []) {
            $options['define'] = $define;
        }

        return $this->program->render($template, $assign, $options);
    }
}
