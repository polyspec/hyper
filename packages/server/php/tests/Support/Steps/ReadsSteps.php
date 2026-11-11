<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\Reads;
use Polyspec\Hyper\Renderer;
use Polyspec\Hyper\Tests\CaseReader;
use Polyspec\Hyper\Tests\Support\ContextRun;

/**
 * HY-73: the cases of contracts/reads.json. A read node is true or a map. Each case is the application `reads_<id>` that
 * scripts/contract-programs.mts builds from the templates of the case, so the render of the template with the kept data
 * and with the data gives the same bytes (HY-73.28).
 */
final class ReadsSteps
{
    private const PROGRAMS = __DIR__ . '/../../../../../../var/contract-programs';

    public static function cases(CaseReader $case): void
    {
        // A read node is true or a map, and an empty map at any depth is an empty object, so it is read as an array.
        $node = json_decode(json_encode($case->input('reads'), JSON_THROW_ON_ERROR), true, 512, JSON_THROW_ON_ERROR);
        $data = $case->input('data');
        $kept = Reads::keep($data, $node);
        $case->compare('kept', $kept);

        $templates = (array) $case->input('templates');
        $template = (string) $case->input('template');
        if (!array_key_exists($template, $templates)) {
            throw new \LogicException("the template {$template} is not among the templates of {$case->id()}");
        }
        $directory = self::PROGRAMS . '/reads_' . $case->id();
        ContextRun::autoload($directory);
        $renderer = Renderer::open("{$directory}/program", 'Z');
        $shared = $renderer->bind([]);
        $case->outcome(
            'render',
            $renderer->alone($template, $shared, $renderer->bind($kept)),
            $renderer->alone($template, $shared, $renderer->bind($data)),
        );
    }
}
