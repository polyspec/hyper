# The steps of contracts/rest.json (HY-49): a rest parameter takes the rest of the path. The match and the refused
# paths are those of contracts/routes.json, so each step runs the step of routes_steps.py, as rest.ts and routes.ts
# share router-cases.ts.
from . import routes_steps


def cases(case) -> None:
    """Compares the route that the router of the case matches for the path."""
    routes_steps.cases(case)


def invalid_paths(case) -> None:
    """Records the error with which the router refuses the path."""
    routes_steps.invalid_paths(case)
