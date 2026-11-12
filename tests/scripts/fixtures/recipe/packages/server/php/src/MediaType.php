<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server;

/**
 * The media type of HY-2.
 */
final class MediaType
{
    private function __construct()
    {
    }

    public static function parse(string $text): self
    {
        JsonCodec::decode($text);

        return new self();
    }

    public function essence(): string
    {
        return $this->folded(new Csrf('k'));
    }

    private function folded(Csrf $csrf): string
    {
        return $csrf->raw();
    }
}
