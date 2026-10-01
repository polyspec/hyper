<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

use Polyspec\Template\Loader\ArrayLoader;
use Polyspec\Template\Loader\FilesystemLoader;
use Polyspec\Template\Loader\LoaderInterface;

/** Loads the reserved template `hyper/data.tpl` (HY-31) and every other template from the application directory. */
final class TemplateLoader implements LoaderInterface
{
    public const DATA_NAME = 'hyper/data.tpl';
    public const DATA_SOURCE = '<script type="application/json" id="hy-data">{= json(response) | raw}</script>';

    private readonly FilesystemLoader $files;
    private readonly ArrayLoader $reserved;

    public function __construct(string $templates)
    {
        $this->files = new FilesystemLoader($templates);
        $this->reserved = new ArrayLoader([self::DATA_NAME => self::DATA_SOURCE]);
    }

    public function load(string $name): ?array
    {
        return $name === self::DATA_NAME ? $this->reserved->load($name) : $this->files->load($name);
    }
}
