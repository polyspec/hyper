"""The media type of a representation request that the server selected, as a representation handler receives it
(HY-106, HY-119): the values of the parameters that the entry requires, in the order of the manifest, and the tag of
a body of the type (HY-122.11)."""

from __future__ import annotations

from ..data._data_model import DataModel
from ..data._json_codec import JsonCodec
from ._representation_response import RepresentationResponse


class MediaType:
    """The selected media type of a representation request."""

    def __init__(self, parameters: dict[str, str], content_type: str = ""):
        self._parameters = dict(parameters)
        self._content_type = content_type

    def parameters(self) -> dict[str, str]:
        """Returns the served value of each required parameter, by its lower-case name, in declared order (HY-119)."""
        return dict(self._parameters)

    def etag(self, body: object) -> str:
        """Returns the strong tag that a 200 response with this body of the selected type has, so that a handler
        compares `If-Match` with it (HY-122.11); a body outside the data model fails with its error (HY-122.13)."""
        return RepresentationResponse.etag(
            self._content_type, JsonCodec.encode(DataModel.check(body))
        )
