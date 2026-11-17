<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

use Polyspec\Template\BoundMap;
use Polyspec\Template\DefineInput;
use Polyspec\Template\Engine;
use Polyspec\Template\Environment;
use Polyspec\Template\FsLoader;

use function Polyspec\Template\bind;
use function Polyspec\Template\merge;

/**
 * Renders documents and single regions with the template extension `polyspec_template` (HY-12, HY-13, HY-30, HY-31,
 * HY-48.15): its `Engine` reads the directory `templates` of the server program that `hyper build` of
 * `@polyspec/hyper-cli` built with an `FsLoader`, as the Node and the Python servers render the same templates.
 * The caller binds each root of a document once with `bind`, and every render merges the bound roots, so the
 * renders of a document check no value again (HY-13, VAL-22).
 *
 * @internal
 */
final class Renderer
{
    public const DATA_NAME = 'hyper/data.tpl';

    private function __construct(
        private readonly Engine $program,
        private readonly string $timezone,
    ) {
    }

    /**
     * Opens the server program that `hyper build` of `@polyspec/hyper-cli` wrote to a directory.
     *
     * @param array<string, mixed> $functions the host functions of the application (HYC-24)
     */
    public static function open(string $program, string $timezone, array $functions = []): self
    {
        // HY-48.16: a missing build fails here and names the first missing output.
        $required = [
            "{$program}/reads.json" => is_file(...),
            "{$program}/build.json" => is_file(...),
            "{$program}/templates" => is_dir(...),
        ];
        foreach ($required as $path => $exists) {
            if (!$exists($path)) {
                throw new HyperValueError(
                    "{$path} of the server program {$program} is missing; "
                    . 'hyper build of @polyspec/hyper-cli builds it',
                    // HY-106.21: only a missing build file has the kind invalid_build.
                    $path === "{$program}/build.json" ? 'invalid_build' : 'invalid_application',
                );
            }
        }
        // HYC-24, RT-5: the engine registers the host functions of the application and fails the open of a name that
        // is built in or an entry that is not a function, with kind `invalid_application` and the message of the
        // engine (HYC-24.2, HYC-24.5, HY-106.21).
        // The extension takes a Closure for each entry, so a callable becomes one and any other entry fails as RT-5
        // states it.
        $closures = [];
        foreach ($functions as $name => $function) {
            if (!is_callable($function)) {
                throw new HyperValueError("functions.{$name} is not a function", 'invalid_application');
            }
            $closures[$name] = \Closure::fromCallable($function);
        }
        $refused = null;
        $engine = null;
        try {
            $engine = new Engine(new FsLoader("{$program}/templates"), $closures);
        } catch (\InvalidArgumentException | \TypeError $error) {
            $refused = $error->getMessage();
        }
        if ($engine === null) {
            throw new HyperValueError((string) $refused, 'invalid_application');
        }

        return new self($engine, $timezone);
    }

    /**
     * Binds a root of the data of a document once, with the bound map of the template extension (VAL-22).
     *
     * @param array<array-key, mixed>|\stdClass $value
     */
    public function bind(array|\stdClass $value): BoundMap
    {
        // An empty PHP array is a list for the extension; a root is a map, so the empty root binds as an empty object.
        $plain = self::plain($value);

        return bind($plain === [] ? new \stdClass() : $plain);
    }

    /**
     * The value with each `JsonSerializable` replaced by its value, which the binding of the extension keeps as a
     * native object (HY-44.6); every other value is kept.
     */
    private static function plain(mixed $value): mixed
    {
        if ($value instanceof \JsonSerializable) {
            return self::plain($value->jsonSerialize());
        }
        if (is_array($value)) {
            return array_map(self::plain(...), $value);
        }
        if ($value instanceof \stdClass) {
            return (object) array_map(self::plain(...), get_object_vars($value));
        }

        return $value;
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
            'build' => '<meta name="hyper-build" content="' . $build . '">',
            'title' => $this->render($title, $shared, []),
            'data' => $data === null ? '' : $this->render(self::DATA_NAME, $data, []),
        ];
        foreach ($regions as $name => $region) {
            $define[$name] = $this->alone(
                $region['template'],
                $shared,
                $region['data'],
                $name === $page ? $routeRegions : [],
            );
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
            $define[$name] = $this->alone($region['template'], $shared, $region['data']);
        }

        return $this->render($template, merge($shared, $data), $define);
    }

    /**
     * Renders one template with an assigned bound root and HTML definitions (HY-14). The `FsLoader` reads files, which
     * the engine does only in `prepare` and `load` (RT-77), so the render is prepared and then rendered.
     *
     * @param array<string, string> $define
     */
    private function render(string $template, BoundMap $assign, array $define): string
    {
        return $this->program->prepareBound(
            $template,
            $assign,
            array_map(static fn (string $html): DefineInput => new DefineInput(null, null, null, $html), $define),
            new Environment($this->timezone, microtime(true)),
        )->render();
    }
}
