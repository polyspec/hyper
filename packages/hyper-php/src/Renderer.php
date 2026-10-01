<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

use Polyspec\Template\AstProgram;
use Polyspec\Template\Engine;

/** Renders documents and single regions with the template engine (HY-12, HY-13, HY-30, HY-31). */
final class Renderer
{
    private readonly Engine $engine;

    public function __construct(string $templates, private readonly string $timezone)
    {
        $this->engine = new Engine(new AstProgram(new TemplateLoader($templates)));
    }

    /**
     * Renders the layout with the title, the data and one definition per region, including route regions.
     *
     * @param array<string, mixed> $shared
     * @param array<string, array{template: string, data: array<string, mixed>}> $regions
     * @param array<string, mixed>|\stdClass $response the document JSON value embedded by `{# data}`
     */
    public function document(string $layout, string $title, array $shared, array $regions, array|\stdClass $response): string
    {
        $define = [
            'layout' => $layout,
            'title' => $title,
            'data' => ['template' => TemplateLoader::DATA_NAME, 'data' => ['response' => $response]],
        ];
        foreach ($regions as $name => $region) {
            $define[$name] = ['template' => $region['template'], 'data' => $region['data']];
        }

        return $this->engine->render('layout', $shared, ['define' => $define, 'env' => ['timezone' => $this->timezone]]);
    }

    /**
     * Renders one template alone with merge(shared, data) as root data; `$define` passes route regions to a page region.
     *
     * @param array<string, mixed> $shared
     * @param array<string, mixed> $data
     * @param array<string, array{template: string, data: array<string, mixed>}> $define
     */
    public function alone(string $template, array $shared, array $data, array $define = []): string
    {
        $root = $shared;
        foreach ($data as $name => $value) {
            $root[$name] = $value;
        }

        return $this->engine->render($template, $root, ['define' => $define, 'env' => ['timezone' => $this->timezone]]);
    }
}
