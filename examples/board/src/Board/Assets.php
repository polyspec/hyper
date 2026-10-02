<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Examples\Board;

/** Reads the asset URLs that the asset build writes to its manifest. */
final class Assets
{
    /** @param array{css: string, reader: string, hyper: string} $urls */
    private function __construct(private readonly array $urls)
    {
    }

    /** Reads the manifest; a missing manifest means the assets were not built. */
    public static function fromManifest(string $file): self
    {
        if (!is_file($file)) {
            throw new \RuntimeException("asset manifest {$file} does not exist; run make assets");
        }
        $urls = json_decode((string) file_get_contents($file), true, flags: JSON_THROW_ON_ERROR);
        foreach (['css', 'reader', 'hyper'] as $name) {
            if (!is_string($urls[$name] ?? null)) {
                throw new \RuntimeException("asset manifest {$file} has no {$name} URL");
            }
        }

        return new self(['css' => $urls['css'], 'reader' => $urls['reader'], 'hyper' => $urls['hyper']]);
    }

    /** @return array{css: string, reader: string, hyper: string} */
    public function urls(): array
    {
        return $this->urls;
    }
}
