<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/** Creates application services once and passes them to loaders and actions by parameter type. */
final class Container
{
    /** @var array<string, \Closure> */
    private array $factories = [];

    /** @var array<string, object> */
    private array $instances = [];

    /** Registers the factory that creates the service of a class. */
    public function bind(string $class, \Closure $factory): void
    {
        $this->factories[$class] = $factory;
        unset($this->instances[$class]);
    }

    /**
     * Calls a function with arguments chosen by parameter type.
     *
     * @param array<string, object> $provided objects for this call keyed by class name
     */
    public function call(\Closure $function, array $provided): mixed
    {
        $arguments = [];
        foreach ((new \ReflectionFunction($function))->getParameters() as $parameter) {
            $type = $parameter->getType();
            if (!$type instanceof \ReflectionNamedType || $type->isBuiltin()) {
                throw new \LogicException("parameter \${$parameter->getName()} has no class type");
            }
            $arguments[] = $provided[$type->getName()] ?? $this->get($type->getName());
        }

        return $function(...$arguments);
    }

    private function get(string $class): object
    {
        if (!isset($this->instances[$class])) {
            $factory = $this->factories[$class] ?? throw new \LogicException("no factory is bound for {$class}");
            $this->instances[$class] = $factory();
        }

        return $this->instances[$class];
    }
}
