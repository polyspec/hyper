<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support;

use Polyspec\Hyper\Tests\CaseReader;
use Polyspec\Hyper\Tests\Support\Steps\AcceptSteps;
use Polyspec\Hyper\Tests\Support\Steps\BuildSteps;
use Polyspec\Hyper\Tests\Support\Steps\ClientSteps;
use Polyspec\Hyper\Tests\Support\Steps\ContextSteps;
use Polyspec\Hyper\Tests\Support\Steps\ContainerSteps;
use Polyspec\Hyper\Tests\Support\Steps\CookiesSteps;
use Polyspec\Hyper\Tests\Support\Steps\CsrfSteps;
use Polyspec\Hyper\Tests\Support\Steps\FieldsSteps;
use Polyspec\Hyper\Tests\Support\Steps\FunctionsSteps;
use Polyspec\Hyper\Tests\Support\Steps\JsonSteps;
use Polyspec\Hyper\Tests\Support\Steps\KeptSteps;
use Polyspec\Hyper\Tests\Support\Steps\ReadsSteps;
use Polyspec\Hyper\Tests\Support\Steps\RepresentationsSteps;
use Polyspec\Hyper\Tests\Support\Steps\RestSteps;
use Polyspec\Hyper\Tests\Support\Steps\RoutesSteps;

/** The step of each (file, section) of the case files that the PHP server runs. */
final class CaseSteps
{
    /** @return ?callable(CaseReader): void null when no step exists */
    public static function of(string $file, string $section): ?callable
    {
        return match ("$file $section") {
            'accept.json parse' => AcceptSteps::parse(...),
            'accept.json select' => AcceptSteps::select(...),
            'cookies.json parse' => CookiesSteps::parse(...),
            'build.json read' => BuildSteps::read(...),
            'container.json services' => ContainerSteps::services(...),
            'csrf.json mask' => CsrfSteps::mask(...),
            'csrf.json masked' => CsrfSteps::masked(...),
            'csrf.json verify' => CsrfSteps::verify(...),
            'fields.json urlencoded' => FieldsSteps::urlencoded(...),
            'fields.json multipart' => FieldsSteps::multipart(...),
            'json.json encode' => JsonSteps::encode(...),
            'json.json decode' => JsonSteps::decode(...),
            'keep.json cases' => KeptSteps::cases(...),
            'keep.json select' => KeptSteps::select(...),
            'reads.json cases' => ReadsSteps::cases(...),
            'routes.json cases' => RoutesSteps::cases(...),
            'routes.json baseCases' => RoutesSteps::baseCases(...),
            'routes.json invalidPaths' => RoutesSteps::invalidPaths(...),
            'rest.json cases' => RestSteps::cases(...),
            'rest.json invalidPaths' => RestSteps::invalidPaths(...),
            'client.json cases' => ClientSteps::cases(...),
            'context.json contexts' => ContextSteps::contexts(...),
            'context.json cases' => ContextSteps::cases(...),
            'functions.json cases' => FunctionsSteps::cases(...),
            'representations.json manifestRejections' => RepresentationsSteps::manifestRejections(...),
            'representations.json openRejections' => RepresentationsSteps::openRejections(...),
            'representations.json cases' => RepresentationsSteps::cases(...),
            default => null,
        };
    }
}
