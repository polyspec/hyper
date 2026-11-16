# The steps of contracts/media-type.json (HY-119.3, HY-122.10, HY-122.11): the parameters of a media type that the
# constructor received and the tag of a body of the type.
from polyspec.hyper.representation.media_type import MediaType

from ..case_rules import FAILURES, raises_of
from .recorded import decoded


def values(case) -> None:
    """Makes the media type with the parameters in the order of their pairs, and with the content type when the case
    states it; compares the parameters and the tag of the value of the body, or the failure of the tag."""
    parameters = {name: value for name, value in case.input("parameters")}
    if case.has("contentType"):
        media = MediaType(parameters, case.input("contentType"))
    else:
        media = MediaType(parameters)
    case.compare("read", media.parameters())
    if not case.has("body"):
        return
    value = decoded(case.input("body"))
    tag = None
    raises = None
    try:
        tag = media.etag(value)
    except FAILURES as failure:
        raises = raises_of(failure)
    case.compare("etag", tag)
    case.compare("raises", raises)
