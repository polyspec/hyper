<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * The media type of a representation request that the server selected, as a representation handler receives it
 * (HY-106, HY-119): the values of the parameters that the entry requires, in the order of the manifest, and the tag
 * of a body of the type (HY-122.11).
 */
final class MediaType
{
    /** @param array<array-key, string> $parameters PHP gives a decimal name as an integer key */
    public function __construct(
        private readonly array $parameters,
        private readonly string $contentType = '',
    ) {
    }

    /**
     * Returns the served value of each required parameter, by its lower-case name, in declared order (HY-119).
     *
     * @return array<array-key, string>
     */
    public function parameters(): array
    {
        return $this->parameters;
    }

    /**
     * Returns the strong tag that a 200 response with this body of the selected type has, so that a handler compares
     * If-Match with it (HY-122.11).
     */
    public function etag(mixed $body): string
    {
        return RepresentationResponse::etag($this->contentType, JsonCodec::encode($body));
    }
}
