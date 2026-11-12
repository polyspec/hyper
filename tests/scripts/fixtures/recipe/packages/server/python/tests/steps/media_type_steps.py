from .essence_reader import EssenceReader


def essence(case) -> None:
    essences = EssenceReader()
    case.compare("expected", essences.read("text/plain"))
