<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server\Tests\Support;

use Polyspec\Hyper\Server\Tests\CaseReader;
use Polyspec\Hyper\Server\Tests\Support\Steps\AcceptSteps;
use Polyspec\Hyper\Server\Tests\Support\Steps\AppSteps;
use Polyspec\Hyper\Server\Tests\Support\Steps\ArgumentsSteps;
use Polyspec\Hyper\Server\Tests\Support\Steps\BuildSteps;
use Polyspec\Hyper\Server\Tests\Support\Steps\ClientSteps;
use Polyspec\Hyper\Server\Tests\Support\Steps\ContextSteps;
use Polyspec\Hyper\Server\Tests\Support\Steps\ContainerSteps;
use Polyspec\Hyper\Server\Tests\Support\Steps\CookiesSteps;
use Polyspec\Hyper\Server\Tests\Support\Steps\CsrfSteps;
use Polyspec\Hyper\Server\Tests\Support\Steps\FieldsSteps;
use Polyspec\Hyper\Server\Tests\Support\Steps\FunctionsSteps;
use Polyspec\Hyper\Server\Tests\Support\Steps\JsonSteps;
use Polyspec\Hyper\Server\Tests\Support\Steps\KeepSteps;
use Polyspec\Hyper\Server\Tests\Support\Steps\ManifestSteps;
use Polyspec\Hyper\Server\Tests\Support\Steps\MediaTypeSteps;
use Polyspec\Hyper\Server\Tests\Support\Steps\ReadsSteps;
use Polyspec\Hyper\Server\Tests\Support\Steps\RepresentationsSteps;
use Polyspec\Hyper\Server\Tests\Support\Steps\RequestSteps;
use Polyspec\Hyper\Server\Tests\Support\Steps\RestSteps;
use Polyspec\Hyper\Server\Tests\Support\Steps\ReplySteps;
use Polyspec\Hyper\Server\Tests\Support\Steps\ResponseSteps;
use Polyspec\Hyper\Server\Tests\Support\Steps\ResultSteps;
use Polyspec\Hyper\Server\Tests\Support\Steps\RoutesSteps;
use Polyspec\Hyper\Server\Tests\Support\Steps\SessionSteps;

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
            'csrf.json browser' => CsrfSteps::browser(...),
            'fields.json urlencoded' => FieldsSteps::urlencoded(...),
            'fields.json multipart' => FieldsSteps::multipart(...),
            'fields.json streamed' => FieldsSteps::streamed(...),
            'json.json encode' => JsonSteps::encode(...),
            'json.json decode' => JsonSteps::decode(...),
            'keep.json cases' => KeepSteps::cases(...),
            'keep.json select' => KeepSteps::select(...),
            'reads.json cases' => ReadsSteps::cases(...),
            'result.json copies' => ResultSteps::copies(...),
            'result.json invalid' => ResultSteps::invalid(...),
            'result.json page' => ResultSteps::page(...),
            'result.json redirect' => ResultSteps::redirect(...),
            'result.json stop' => ResultSteps::stop(...),
            'reply.json cookies' => ReplySteps::cookies(...),
            'request.json texts' => RequestSteps::texts(...),
            'request.json files' => RequestSteps::files(...),
            'reply.json cacheControl' => ReplySteps::cacheControl(...),
            'reply.json referrerPolicy' => ReplySteps::referrerPolicy(...),
            'reply.json status' => ReplySteps::status(...),
            'reply.json notes' => ReplySteps::notes(...),
            'reply.json flags' => ReplySteps::flags(...),
            'result.json types' => ResultSteps::types(...),
            'routes.json cases' => RoutesSteps::cases(...),
            'routes.json baseCases' => RoutesSteps::baseCases(...),
            'routes.json invalidPaths' => RoutesSteps::invalidPaths(...),
            'rest.json cases' => RestSteps::cases(...),
            'rest.json invalidPaths' => RestSteps::invalidPaths(...),
            'client.json cases' => ClientSteps::cases(...),
            'context.json contexts' => ContextSteps::contexts(...),
            'context.json withContext' => ContextSteps::withContext(...),
            'context.json cases' => ContextSteps::cases(...),
            'functions.json cases' => FunctionsSteps::cases(...),
            'representations.json manifestRejections' => RepresentationsSteps::manifestRejections(...),
            'representations.json openRejections' => RepresentationsSteps::openRejections(...),
            'representations.json cases' => RepresentationsSteps::cases(...),
            'session.json token' => SessionSteps::token(...),
            'session.json flash' => SessionSteps::flash(...),
            'session.json kept' => SessionSteps::kept(...),
            'manifest.json checks' => ManifestSteps::checks(...),
            'manifest.json reads' => ManifestSteps::reads(...),
            'request.json targets' => RequestSteps::targets(...),
            'request.json values' => RequestSteps::values(...),
            'build.json outputs' => BuildSteps::outputs(...),
            'client.json openRejections' => ClientSteps::openRejections(...),
            'app.json cases' => AppSteps::cases(...),
            'app.json opens' => AppSteps::opens(...),
            'app.json parts' => AppSteps::parts(...),
            'arguments.json counts' => ArgumentsSteps::counts(...),
            'arguments.json names' => ArgumentsSteps::names(...),
            'media-type.json values' => MediaTypeSteps::values(...),
            'response.json values' => ResponseSteps::values(...),
            'fields.json uploaded' => FieldsSteps::uploaded(...),
            'session.json store' => SessionSteps::store(...),
            'client.json declaration' => ClientSteps::declaration(...),
            'representations.json values' => RepresentationsSteps::values(...),
            default => null,
        };
    }
}
