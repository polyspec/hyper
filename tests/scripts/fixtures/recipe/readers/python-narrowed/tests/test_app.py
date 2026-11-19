from src.app import App


def test_routed() -> None:
    assert App(None) is not None
