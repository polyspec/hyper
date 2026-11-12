<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server\Tests\Support\Steps;

use Polyspec\Hyper\Server\MediaType;
use Polyspec\Hyper\Server\Tests\CaseReader;
use Polyspec\Hyper\Server\Tests\Support\CaseInput;
use Polyspec\Hyper\Server\Tests\Support\Json;
use Polyspec\Hyper\Server\Tests\Support\Plain;

/** HY-119, HY-122: the cases of contracts/media-type.json, the media type that a representation handler receives. */
final class MediaTypeSteps
{
    /** Makes the media type of the parameters and records its parameters and the tag of the body of the case. */
    public static function values(CaseReader $case): void
    {
        $parameters = [];
        foreach (Json::list($case->input('parameters')) as $pair) {
            [$name, $value] = Json::strings($pair);
            $parameters[$name] = $value;
        }
        $media = $case->has('contentType')
            ? new MediaType($parameters, CaseInput::text($case, 'contentType'))
            : new MediaType($parameters);
        $case->compare('read', Plain::map($media->parameters()));
        if (!$case->has('body')) {
            return;
        }
        $body = Json::value(CaseInput::text($case, 'body'));
        if (!$case->has('failure')) {
            $case->compare('etag', $media->etag($body));

            return;
        }
        // HY-122.13: a body outside the data model fails with the error of the data model; a tag fails the case.
        $failure = null;
        try {
            $media->etag($body);
        } catch (\InvalidArgumentException $error) {
            $failure = $error->getMessage();
        }
        $case->compare('failure', $failure);
    }
}
