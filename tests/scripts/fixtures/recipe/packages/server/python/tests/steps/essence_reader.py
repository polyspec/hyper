from polyspec.hyper.server.media_type import MediaType


class EssenceReader:
    def read(self, text: str) -> str:
        return MediaType.parse(text).essence()
