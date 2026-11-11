<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\Container;
use Polyspec\Hyper\Tests\CaseReader;

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
        } catch (\LogicException) {
            $failed = true;
        }
        $case->compare('created', $created);
        $case->compare('failed', $failed);
    }

    /** @return list<'clock'|'mailer'> */
    private static function names(CaseReader $case, string $field): array
    {
        $names = [];
        foreach ((array) $case->input($field) as $name) {
            $names[] = $name === 'clock' ? 'clock' : 'mailer';
        }

        return $names;
    }
}
