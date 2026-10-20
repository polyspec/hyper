"""The fields of a request as the conformance cases of contracts/fields.json state them."""

from polyspec.hyper._fields import Fields


def entries(fields: Fields | None) -> list | None:
    """The [name, values] pairs of `fields` in order, or None for fields that are invalid."""
    if fields is None:
        return None
    return [[name, fields.get(name)] for name in fields.names()]
