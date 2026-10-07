<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

use Polyspec\Template\BoundMap;
use Polyspec\Template\Native\BoundMap as NativeBoundMap;
use Polyspec\Template\Native\Engine as NativeEngine;
use Polyspec\Template\Program;

/**
 * Renders documents and single regions with the compiled program of the application: the native template
 * extension when PHP has loaded it, and otherwise the generated PHP program (HY-12, HY-13, HY-30, HY-31, HY-48).
 * The caller binds each root of a document once with `bind`, and every render merges the bound roots, so the
 * renders of a document check no value again (HY-13, VAL-22).
 */
final class Renderer
{
    public const DATA_NAME = 'hyper/data.tpl';

    private function __construct(private readonly Program|NativeEngine $program, public readonly string $engine, private readonly string $timezone)
    {
    }

    /** Opens the program that `hyper-build-server` of `@polyspec/hyper-build` wrote to a directory. */
    public static function open(string $program, string $timezone): self
    {
        // A missing build fails here and names the missing file (HY-48).
        foreach (["{$program}/program.php" => is_file(...), "{$program}/program.json" => is_file(...), "{$program}/reads.json" => is_file(...), "{$program}/templates" => is_dir(...)] as $path => $exists) {
            if (!$exists($path)) {
                throw new \InvalidArgumentException("{$path} of the server program {$program} is missing; hyper-build-server of @polyspec/hyper-build builds it");
            }
        }
        if (extension_loaded('polyspec_template')) {
            return new self(new NativeEngine("{$program}/templates"), 'native', $timezone);
        }
        // The generated program is declared in the namespace that the build chose (HY-48).
        $declaration = json_decode((string) file_get_contents("{$program}/program.json"), true, flags: JSON_THROW_ON_ERROR);
        $namespace = is_array($declaration) ? $declaration['namespace'] ?? null : null;
        if (!is_string($namespace)) {
            throw new \InvalidArgumentException("{$program}/program.json names no namespace");
        }
        require_once "{$program}/program.php";
        $class = "\\{$namespace}\\GeneratedProgram";
        $generated = new $class();
        if (!$generated instanceof Program) {
            throw new \InvalidArgumentException("{$class} of the server program {$program} is not a template program");
        }

        return new self($generated, 'generated', $timezone);
    }

    /**
     * Binds a root of the data of a document once, with the bound map of the program (VAL-22): the native
     * extension takes only its own bound maps, and the generated program only those of the PHP package.
     *
     * @param array<array-key, mixed>|\stdClass $value
     */
    public function bind(array|\stdClass $value): BoundMap|NativeBoundMap
    {
        return $this->program instanceof NativeEngine ? NativeBoundMap::bind($value) : BoundMap::bind($value);
    }

    /**
     * Renders the document: the layout with the title, the embedded data and every manifest region rendered
     * alone as HTML definitions; the page region receives its route regions the same way.
     *
     * @param array<string, array{template: string, data: BoundMap|NativeBoundMap}> $regions manifest regions
     * @param array<string, array{template: string, data: BoundMap|NativeBoundMap}> $routeRegions route regions of the page region
     * @param BoundMap|NativeBoundMap|null $data the bound root of `{# data}`, the map with the member `response` (HY-31), or null when the document embeds no data (HY-92)
     */
    public function document(string $layout, string $title, BoundMap|NativeBoundMap $shared, array $regions, string $page, array $routeRegions, BoundMap|NativeBoundMap|null $data): string
    {
        $define = [
            'title' => ['html' => $this->render($title, $shared, [])],
            'data' => ['html' => $data === null ? '' : $this->render(self::DATA_NAME, $data, [])],
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
     * @param array<string, array{template: string, data: BoundMap|NativeBoundMap}> $routeRegions
     */
    public function alone(string $template, BoundMap|NativeBoundMap $shared, BoundMap|NativeBoundMap $data, array $routeRegions = []): string
    {
        $define = [];
        foreach ($routeRegions as $name => $region) {
            $define[$name] = ['html' => $this->alone($region['template'], $shared, $region['data'])];
        }

        return $this->render($template, $this->program instanceof NativeEngine ? NativeBoundMap::merge($shared, $data) : BoundMap::merge($shared, $data), $define);
    }

    /** @param array<string, array{html: string}> $define */
    private function render(string $template, BoundMap|NativeBoundMap $assign, array $define): string
    {
        $options = ['env' => ['timezone' => $this->timezone]];
        if ($define !== []) {
            $options['define'] = $define;
        }

        return $this->program->render($template, $assign, $options);
    }
}
