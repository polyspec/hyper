# The services of the handlers are created once, on their first use (HY-105), as the Node and PHP servers create them.
import unittest

from polyspec.hyper.container import Container


class Service:
    pass


class ContainerTest(unittest.TestCase):
    def test_creates_a_service_once_on_its_first_use(self) -> None:
        created = []

        def make() -> Service:
            created.append(1)
            return Service()

        container = Container()
        container.bind(Service, make)
        self.assertEqual([], created)

        def first(service: Service) -> Service:
            return service

        def second(service: Service) -> Service:
            return service

        self.assertIs(container.call(first, {}), container.call(second, {}))
        self.assertEqual(1, len(created))

    def test_fails_for_a_service_without_a_factory(self) -> None:
        # HY-105: a service without a factory fails, and the request fails with HY-43.
        def use(service: Service) -> Service:
            return service

        with self.assertRaisesRegex(TypeError, "no factory is bound for Service"):
            Container().call(use, {})


if __name__ == "__main__":
    unittest.main()
