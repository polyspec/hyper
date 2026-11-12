from .base_case import BaseCase, Mixin


class DerivedTest(Mixin, BaseCase):
    def test_own(self) -> None:
        pass
