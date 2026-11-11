<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support;

use Polyspec\Hyper\MediaType;
use Polyspec\Hyper\Representation;
use Polyspec\Hyper\Request;

/**
 * The representation handlers of a case (HY-118): each records its call and what it received, and answers or throws
 * what the case states. `manifest` writes the manifest that declares the entries of a case.
 */
final class RepresentationCalls
{
    /** The number of calls of the handlers. */
    public int $handled = 0;

    /** The request that the last handler received, or null. */
    public ?Request $request = null;

    /** @var array<array-key, string> the media parameters that the last handler received */
    public array $parameters = [];

    /**
     * Returns a handler that answers the response of a case, which has `status`, `body` and `headers`, or throws the
     * error of its `throw`; without a response the handler fails, because the case states no call.
     */
    public function handler(mixed $response): \Closure
    {
        return function (Request $request, MediaType $media) use ($response): Representation {
            $this->handled++;
            $this->request = $request;
            $this->parameters = $media->parameters();
            if (!is_array($response)) {
                throw new \LogicException('a case without a handler calls a representation handler');
            }
            if (isset($response['throw'])) {
                $thrown = Json::array($response['throw']);
                if (($thrown['class'] ?? null) !== 'OrmError') {
                    throw new \LogicException('the case throws an unknown class');
                }

                throw new OrmException(Json::string($thrown['code'] ?? null));
            }
            $status = $response['status'] ?? null;
            if (!is_int($status)) {
                throw new \LogicException('the handler of the case has no status');
            }
            $headers = $response['headers'] ?? [];

            return new Representation(
                $status,
                $response['body'] ?? null,
                Json::stringMap(is_array($headers) ? $headers : []),
            );
        };
    }

    /**
     * Returns the headers of the request that the last handler received, among the given names.
     *
     * @param list<string> $names
     * @return array<string, string>
     */
    public function headers(array $names): array
    {
        $headers = [];
        foreach ($names as $name) {
            $value = $this->request?->header($name);
            if ($value !== null) {
                $headers[$name] = $value;
            }
        }

        return $headers;
    }

    /**
     * Writes a copy of a manifest whose routes declare the given representations, each as a case states it, and
     * returns the path of the copy, which the caller removes.
     *
     * @param array<string, mixed> $representations the value of `representations` by the route name
     */
    public static function manifest(string $source, array $representations): string
    {
        $manifest = Json::objectFile($source);
        foreach (is_array($manifest->routes ?? null) ? $manifest->routes : [] as $route) {
            $name = $route instanceof \stdClass ? ($route->name ?? null) : null;
            if ($route instanceof \stdClass && is_string($name) && array_key_exists($name, $representations)) {
                $route->representations = $representations[$name];
            }
        }
        $file = tempnam(sys_get_temp_dir(), 'hyper-manifest-');
        if ($file === false) {
            throw new \RuntimeException('no temporary file for the manifest of a case');
        }
        file_put_contents($file, json_encode($manifest, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE));

        return $file;
    }
}
