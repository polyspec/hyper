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


def services(case) -> None:
    container = Container()
    created = 0

    def factory(cls: type):
        def create() -> object:
            nonlocal created
            created += 1
            return cls()

        return create

    for name in case.input("bound"):
        cls = Clock if name == "clock" else Mailer
        container.bind(cls, factory(cls))
    failed = False
    try:
        for name in case.input("uses"):
            container.call(use_clock if name == "clock" else use_mailer, {})
    except TypeError:
        failed = True
    case.compare("created", created)
    case.compare("failed", failed)
