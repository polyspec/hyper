<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\ArraySession;
use Polyspec\Hyper\Flash;
use Polyspec\Hyper\Session;
use Polyspec\Hyper\SessionStore;
use Polyspec\Hyper\Tests\CaseReader;
use Polyspec\Hyper\Tests\Support\Json;

/**
 * HY-24, HY-25, HY-40, HY-72, HY-104.23: the cases of contracts/session.json. The calls of a case are applied in order
 * to one session over a new ArraySession.
 */
final class SessionSteps
{
    /** Records the number of each token among the distinct tokens, their form and the renewals of the store. */
    public static function token(CaseReader $case): void
    {
        $store = new ArraySession();
        $session = new Session($store);
        $distinct = [];
        $tokens = [];
        foreach (self::calls($case) as [$method, $arguments]) {
            $result = self::call($session, $method, $arguments);
            if ($method === 'csrfToken') {
                $token = Json::string($result);
                if (!in_array($token, $distinct, true)) {
                    $distinct[] = $token;
                }
                $tokens[] = (int) array_search($token, $distinct, true) + 1;
            }
        }
        $hexadecimal = true;
        foreach ($distinct as $token) {
            $hexadecimal = $hexadecimal && preg_match('/^[0-9a-f]{64}$/D', $token) === 1;
        }
        $case->compare('tokens', $tokens);
        $case->compare('hexadecimal', $hexadecimal);
        $case->compare('renewals', $store->renewals());
    }

    public static function flash(CaseReader $case): void
    {
        self::stored($case, false);
    }

    public static function kept(CaseReader $case): void
    {
        self::stored($case, $case->has('failure'));
    }

    /** Applies the calls to one ArraySession through the session store interface (HY-72, HY-104). */
    public static function store(CaseReader $case): void
    {
        $session = new ArraySession();
        $store = self::asStore($session);
        $results = [];
        foreach (self::calls($case) as [$method, $arguments]) {
            $key = static fn (): string => Json::string($arguments[0] ?? null);
            $result = null;
            match ($method) {
                'get' => $result = $store->get($key()),
                'set' => $store->set($key(), $arguments[1] ?? null),
                'remove' => $store->remove($key()),
                'renew' => $store->renew(),
                default => throw new \LogicException("the method {$method} of the case is unknown"),
            };
            $results[] = $result;
        }
        $case->compare('results', $results);
        $case->compare('renewals', $session->renewals());
    }

    private static function asStore(SessionStore $store): SessionStore
    {
        return $store;
    }

    /**
     * Applies the calls over the stored values of the case until one fails with the error of a stored value of another
     * form (HY-104.23), and compares the result of each call that returned and whether a call failed so. When the case
     * expects a failure, a call that fails with the error of the data model also stops, and its message is compared.
     */
    private static function stored(CaseReader $case, bool $fails): void
    {
        $store = new ArraySession();
        if ($case->has('stored')) {
            foreach (Json::list($case->input('stored')) as $pair) {
                $pair = Json::list($pair);
                $value = json_decode(Json::string($pair[1] ?? null), false, 512, JSON_THROW_ON_ERROR);
                $store->set(Json::string($pair[0] ?? null), self::record($value));
            }
        }
        $session = new Session($store);
        $results = [];
        $error = null;
        $failed = null;
        foreach (self::calls($case) as [$method, $arguments]) {
            try {
                $result = self::call($session, $method, $arguments);
            } catch (\UnexpectedValueException $failure) {
                if ($failure::class !== \UnexpectedValueException::class) {
                    throw $failure;
                }
                $error = 'stored';
                break;
            } catch (\InvalidArgumentException $failure) {
                // HY-40.4: a kept value outside the data model fails with the error of the data model.
                if ($failure::class !== \InvalidArgumentException::class || !$fails) {
                    throw $failure;
                }
                $failed = $failure->getMessage();
                break;
            }
            $results[] = match (true) {
                $result instanceof Flash => self::flashPairs($result),
                is_array($result) => self::pairs($result),
                default => null,
            };
        }
        $case->compare('results', $results);
        $case->compare('error', $error);
        if ($fails) {
            $case->compare('failure', $failed);
        }
    }

    /**
     * The calls of the case, each a method and its arguments, which the JSON texts give as a handler gives them.
     *
     * @return list<array{0: string, 1: list<mixed>}>
     */
    private static function calls(CaseReader $case): array
    {
        $calls = [];
        foreach (Json::list($case->input('calls')) as $entry) {
            $entry = Json::list($entry);
            $arguments = [];
            foreach (Json::strings($entry[1] ?? null) as $text) {
                $arguments[] = Json::value($text);
            }
            $calls[] = [Json::string($entry[0] ?? null), $arguments];
        }

        return $calls;
    }

    /** @param list<mixed> $arguments */
    private static function call(Session $session, string $method, array $arguments): mixed
    {
        return match ($method) {
            'csrfToken' => $session->csrfToken(),
            'renew' => $session->renew(),
            'takeFlash' => $session->takeFlash(),
            'putFlash' => $session->putFlash(
                new Flash(Json::array($arguments[0] ?? null), Json::strings($arguments[1] ?? null)),
            ),
            'keep' => $session->keep(
                Json::string($arguments[0] ?? null),
                Json::string($arguments[1] ?? null),
                $arguments[2] ?? null,
            ),
            'kept' => $session->kept(Json::string($arguments[0] ?? null)),
            default => throw new \LogicException("the method {$method} of the case is unknown"),
        };
    }

    /**
     * The value of a shared record as the PHP store gives it (HY-104.13, HY-104.14): a list is a list, an empty map and
     * a map with the keys 0 to n-1 in order are a stdClass, and every other map is an array, at every depth.
     */
    private static function record(mixed $value): mixed
    {
        if (is_array($value)) {
            return array_map(self::record(...), $value);
        }
        if (!$value instanceof \stdClass) {
            return $value;
        }
        $map = array_map(self::record(...), get_object_vars($value));

        return array_is_list($map) ? (object) $map : $map;
    }

    /**
     * The values of a flash as pairs, and its changed values.
     *
     * @return array{values: list<array{0: string, 1: mixed}>, changed: array<array-key, mixed>}
     */
    private static function flashPairs(Flash $flash): array
    {
        return ['values' => self::pairs($flash->values), 'changed' => $flash->changed];
    }

    /**
     * The entries of a map as pairs of a key, as text, and its value, in the order of the map.
     *
     * @param array<array-key, mixed> $map
     * @return list<array{0: string, 1: mixed}>
     */
    private static function pairs(array $map): array
    {
        $pairs = [];
        foreach ($map as $key => $value) {
            $pairs[] = [(string) $key, $value];
        }

        return $pairs;
    }
}
