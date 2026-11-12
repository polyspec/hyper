# The inputs that several steps read from a case in one form: the options of an open and the calls of a member.


def options_of(case, names: dict[str, str], convert=lambda name, value: value) -> dict:
    """The keyword arguments of the options of a case, by the names of `names`; an unknown option fails."""
    options = {}
    for name, value in (case.input("options") if case.has("options") else {}).items():
        if name not in names:
            raise LookupError(f"the option {name} of the case is unknown")
        options[names[name]] = convert(name, value)
    return options


def calls_of(case) -> list:
    """The calls of a case, each a method and a list of JSON texts; another form fails."""
    calls = case.input("calls")
    if not isinstance(calls, list):
        raise ValueError("the calls of the case are not a list")
    for entry in calls:
        if (
            not isinstance(entry, list)
            or len(entry) != 2
            or not isinstance(entry[0], str)
            or not isinstance(entry[1], list)
        ):
            raise LookupError(
                "a call of the case is not a method and a list of JSON texts"
            )
    return calls
