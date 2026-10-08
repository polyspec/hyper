"""Creates application services once and passes them to loaders and actions by parameter type, as the handlers of
the PHP server receive them (HY-62)."""

from __future__ import annotations

import inspect


class Container:
    """Calls a function with arguments chosen by parameter type (HY-62)."""

    def __init__(self):
        self._factories: dict[type, 'callable[[], object]'] = {}
        self._instances: dict[type, object] = {}

    def bind(self, cls: type, factory: 'callable[[], object]') -> None:
        """Registers the factory that creates the service of a class."""
        self._factories[cls] = factory
        self._instances.pop(cls, None)

    def call(self, function: 'callable', provided: dict[object, object]) -> object:
        """Calls a function with an argument for every parameter: a parameter whose annotation names a class
        receives a provided object of this call or the service of the class that `bind` registered, and a parameter
        without an annotation receives the provided object of its name, which is how a lambda names the request
        `request` and the reply `reply`."""
        arguments = []
        for parameter in inspect.signature(function).parameters.values():
            annotation = parameter.annotation
            if annotation is inspect.Parameter.empty:
                if parameter.name not in provided:
                    raise TypeError(f'parameter {parameter.name} has no class type')
                arguments.append(provided[parameter.name])
                continue
            if not isinstance(annotation, type) or annotation in (str, int, float, bool, bytes, object):
                raise TypeError(f'parameter {parameter.name} has no class type')
            arguments.append(provided[annotation] if annotation in provided else self._service(annotation))
        return function(*arguments)

    def _service(self, cls: type) -> object:
        if cls not in self._instances:
            factory = self._factories.get(cls)
            if factory is None:
                raise TypeError(f'no factory is bound for {cls.__name__}')
            instance = factory()
            if not isinstance(instance, cls):
                raise TypeError(f'the factory of {cls.__name__} did not return an instance of it')
            self._instances[cls] = instance
        return self._instances[cls]
