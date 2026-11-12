<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Server\Tests\Support\Steps;

use Polyspec\Hyper\Server\Container;
use Polyspec\Hyper\Server\Tests\CaseReader;

/** HY-105: the cases of contracts/container.json, the services that the handlers receive. */
final class ContainerSteps
{
    /** The class of each service name of the cases; a handler names a service by the class of a parameter. */
    private const CLASSES = ['clock' => \ArrayObject::class, 'mailer' => \SplObjectStorage::class];

    public static function services(CaseReader $case): void
    {
        $container = new Container();
        $created = 0;
        foreach (self::names($case, 'bound') as $name) {
            $class = self::CLASSES[$name];
            $container->bind($class, static function () use ($class, &$created): object {
                ++$created;

                return new $class();
            });
        }
        $failed = false;
        try {
            foreach (self::names($case, 'uses') as $name) {
                $container->call(match ($name) {
                    'clock' => static fn (\ArrayObject $service): object => $service,
                    default => static fn (\SplObjectStorage $service): object => $service,
                }, []);
            }
        } catch (\LogicException $error) {
            if (!str_contains($error->getMessage(), 'no factory is bound for')) {
                throw $error;
            }
            $failed = true;
        }
        $case->compare('created', $created);
        $case->compare('failed', $failed);
    }

    /**
     * Returns the service names of a field, and fails for a value that is not a list of the names of the cases.
     *
     * @return list<'clock'|'mailer'>
     */
    private static function names(CaseReader $case, string $field): array
    {
        $value = $case->input($field);
        if (!is_array($value) || !array_is_list($value)) {
            throw new \UnexpectedValueException("the case field {$field} is not a list");
        }
        $names = [];
        foreach ($value as $name) {
            if ($name !== 'clock' && $name !== 'mailer') {
                throw new \UnexpectedValueException(
                    "the case field {$field} names the unknown service " . var_export($name, true),
                );
            }
            $names[] = $name;
        }

        return $names;
    }
}
