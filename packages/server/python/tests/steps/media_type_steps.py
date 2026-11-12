# The steps of contracts/media-type.json (HY-119.3, HY-122.10, HY-122.11): the parameters of a media type that the
# constructor received and the tag of a body of the type.
from polyspec.hyper.media_type import MediaType

from .data_model_errors import data_model_message
from .recorded import decoded


def values(case) -> None:
    """Makes the media type with the parameters in the order of their pairs, and with the content type when the case
    states it; compares the parameters and the tag of the value of the body, or the error of the data model."""
    parameters = {name: value for name, value in case.input("parameters")}
    if case.has("contentType"):
        media = MediaType(parameters, case.input("contentType"))
    else:
        media = MediaType(parameters)
    case.compare("read", media.parameters())
    if not case.has("body"):
        return
    value = decoded(case.input("body"))
    if not case.has("failure"):
        case.compare("etag", media.etag(value))
        return
    try:
        tag = media.etag(value)
    except ValueError as error:
        message = data_model_message(error)
        if message is None:
            raise
        case.compare("failure", message)
        return
    raise LookupError(f"etag(value) returned {tag} for a body outside the data model")
