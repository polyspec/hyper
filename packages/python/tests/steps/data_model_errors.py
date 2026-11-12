# The error of the data model as a step tells it from another error (HY-44.8): in Python both the error of the data
# model and the stored-form error of HY-104.23 are exactly ValueError, so the step holds the five messages of the data
# model as its own list, the messages of the PHP constant DataModel::MESSAGES.
from typing import Optional

MESSAGES = (
    "a number outside ±(2^53 − 1) is not a value of the data model (HY-44)",
    "a number that is not finite is not a value of the data model (HY-44)",
    "a string that is not UTF-8 text is not a value of the data model (HY-44)",
    "lists and maps that nest deeper than 64 levels are not a value of the data model (HY-44)",
    "a value or a map key of another type is not a value of the data model (HY-44)",
)


def data_model_message(error: BaseException) -> Optional[str]:
    """The message of an error of the data model, or None for any other error."""
    if type(error) is ValueError and str(error) in MESSAGES:
        return str(error)
    return None
