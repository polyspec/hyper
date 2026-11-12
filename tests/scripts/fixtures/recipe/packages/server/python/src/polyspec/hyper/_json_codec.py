"""The JSON codec of HY-2."""

from polyspec.hyper._signed_token import SignedToken


class JsonCodec:
    @staticmethod
    def decode(text: str) -> str:
        for token in SignedToken.all():
            text += token.text()
        return text
