# The steps of contracts/container.json (HY-105): the services that the handlers receive.
from polyspec.hyper.container import Container


class Clock:
    pass


class Mailer:
    pass


def use_clock(service: Clock) -> object:
    return service


def use_mailer(service: Mailer) -> object:
    return service


SERVICES = {"clock": Clock, "mailer": Mailer}
USES = {"clock": use_clock, "mailer": use_mailer}


def _names(case, field: str) -> list[str]:
    """Returns the service names of a field, and fails for a value that is not a list of the names of the cases."""
    value = case.input(field)
    if not isinstance(value, list):
        raise TypeError(f"the case field {field} is not a list")
    for name in value:
        if name not in SERVICES:
            raise ValueError(
                f"the case field {field} names the unknown service {name!r}"
            )
    return value


def services(case) -> None:
    container = Container()
    created = 0

    def factory(cls: type):
        def create() -> object:
            nonlocal created
            created += 1
            return cls()

        return create

    for name in _names(case, "bound"):
        cls = SERVICES[name]
        container.bind(cls, factory(cls))
    failed = False
    try:
        for name in _names(case, "uses"):
            container.call(USES[name], {})
    except TypeError as error:
        if "no factory is bound for" not in str(error):
            raise
        failed = True
    case.compare("created", created)
    case.compare("failed", failed)
