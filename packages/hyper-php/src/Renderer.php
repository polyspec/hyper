<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

use Polyspec\Template\AstProgram;
use Polyspec\Template\Engine;
use Polyspec\Template\Loader\FilesystemLoader;

/** Renders documents and single regions with the template engine (HY-12, HY-13). */
final class Renderer
{
    private readonly Engine $engine;

    public function __construct(string $templates, private readonly string $timezone)
    {
        $this->engine = new Engine(new AstProgram(new FilesystemLoader($templates)));
    }

    /**
     * Renders the layout with the title definition and one definition per region.
     *
     * @param array<string, mixed> $shared
     * @param array<string, array{template: string, data: array<string, mixed>}> $regions
     */
    public function document(string $layout, string $title, array $shared, array $regions): string
    {
        $define = ['layout' => $layout, 'title' => $title];
        foreach ($regions as $name => $region) {
            $define[$name] = ['template' => $region['template'], 'data' => $region['data']];
        }

        return $this->engine->render('layout', $shared, ['define' => $define, 'env' => ['timezone' => $this->timezone]]);
    }

    /**
     * Renders one template alone with merge(shared, data) as root data.
     *
     * @param array<string, mixed> $shared
     * @param array<string, mixed> $data
     */
    public function alone(string $template, array $shared, array $data): string
    {
        $root = $shared;
        foreach ($data as $name => $value) {
            $root[$name] = $value;
        }

        return $this->engine->render($template, $root, ['env' => ['timezone' => $this->timezone]]);
    }
}
