# The applications of contracts/context.json (HY-10, HY-124 to HY-128): the cases run in steps/context_steps.py, which
# open each application with its build, its context, its shared data and its handlers. This module keeps the helpers
# that open the applications of the contract.
import json
from pathlib import Path

from polyspec.hyper.app import App
from polyspec.hyper.reply import Reply
from polyspec.hyper.request import Request
from polyspec.hyper.not_found import NotFound
from polyspec.hyper.result import Result


ROOT = Path(__file__).resolve().parents[5]
PROGRAMS = ROOT / "var" / "contract-programs"


class OrmError(Exception):
    """An error shaped like the OrmError of polyspec.orm, which hyper identifies by its class name and its code (HY-107)."""

    def __init__(self, code: str):
        super().__init__(f"{code}: a failure of the ORM")
        self.code = code


def program_of(name: str) -> tuple[Path, Path]:
    """Returns the manifest path and the program directory that scripts/contract-programs.mts wrote for an application;
    a missing output fails here and names the missing file."""
    root = PROGRAMS / name
    for path in (root / "manifest.json", root / "build.json", root / "program"):
        if not path.exists():
            raise FileNotFoundError(f"{path} is missing: run make contract-programs")
    return root / "manifest.json", root / "program"


def _reject(name: str) -> None:
    """Fails for a constant of a JSON text that JSON does not define."""
    raise ValueError(f"the case context holds {name}, which is not JSON")


def _thrown(handler: str, thrown: object) -> OrmError:
    """Returns the ORM error that a handler of the contract raises (HY-107.2), and fails for another class."""
    if (
        not isinstance(thrown, dict)
        or thrown.get("class") != "OrmError"
        or not isinstance(thrown.get("code"), str)
    ):
        raise ValueError(
            f"handler {handler} throws a value other than an OrmError with a code"
        )
    return OrmError(thrown["code"])


def open_application(
    application: dict,
    shared: dict | None,
    manifest: Path,
    program: Path,
    calls: list,
    selections: list,
    context: str | None = None,
    failures: list | None = None,
) -> App:
    """Opens the application with the handlers of its contract: a loader stops with NotFound when it says so, renews
    the session of its reply for `renew` and raises the ORM error of `throw` (HY-107.2); an action renews the session
    of its reply first for `renew`, and then raises the ORM error of `throw` or returns the page with its status or
    the redirect; the handlers record their calls in order. A route region without an entry in `loaders` has no loader. The shared handler
    returns the shared data of the case, and an application without shared data has no shared handler. The context
    handler returns the decoded JSON text `context`, or the context of the application, as it is, also a value that
    is not a map, so that the server checks it (HY-124); the response hook appends the failure of each response to
    `failures` (HY-60)."""
    loaders = application["loaders"]
    if not isinstance(loaders, dict) or not all(
        isinstance(data, dict) for data in loaders.values()
    ):
        raise ValueError("the loaders are not a map of maps")
    # An absent member declares none; a present member must have its type.
    embed_data = application.get("embedData", [])
    if not isinstance(embed_data, list) or not all(
        isinstance(name, str) for name in embed_data
    ):
        raise ValueError("embedData is not a list of strings")
    embed = set(embed_data)
    actions = application.get("actions", {})
    if not isinstance(actions, dict):
        raise ValueError("the actions are not a map")

    def loader(route: str, data: dict):
        def load(request: Request, reply: Reply) -> dict:
            if route in embed:
                reply.embed_data()
            if "stop" in data:
                if data["stop"] != "NotFound":
                    raise ValueError(
                        f"loader {route} stops with a value other than NotFound"
                    )
                raise NotFound()
            if "throw" in data:
                raise _thrown(route, data["throw"])
            if "renew" in data:
                if data["renew"] is not True:
                    raise ValueError(f"the renew of loader {route} is not true")
                reply.renew_session()
                return {}
            return dict(data)

        return load

    def action(route: str, spec: dict):
        def run(request: Request, reply: Reply) -> Result:
            calls.append(f"action:{route}")
            if "renew" in spec:
                if spec["renew"] is not True:
                    raise ValueError(f"the renew of action {route} is not true")
                reply.renew_session()
            if "throw" in spec:
                raise _thrown(route, spec["throw"])
            if "redirect" in spec:
                if not isinstance(spec["redirect"], str):
                    raise ValueError(f"the redirect of {route} is not a string")
                return Result.redirect(spec["redirect"])
            # type() and not isinstance(): a bool is an int of Python, but not an integer of JSON.
            if type(spec.get("page")) is not int or not isinstance(
                spec.get("data"), dict
            ):
                raise ValueError(
                    f"the action of {route} has no redirect and no page with data"
                )
            return Result.page(spec["page"], dict(spec["data"]))

        return run

    def shared_data(request: Request) -> dict:
        calls.append("shared")
        return dict(shared)

    routes = {}
    for route in application["manifest"]["routes"]:
        name = route["name"]
        entry: dict = {}
        if name in loaders:
            entry["load"] = loader(name, loaders[name])
        # Only a declared action is registered, as in PHP and Node.
        if name in actions:
            entry["post"] = action(name, actions[name])
        regions = {}
        for region in route.get("regions", []):
            if region["name"] in loaders:
                regions[region["name"]] = loader(
                    region["name"], loaders[region["name"]]
                )
        if regions:
            entry["regions"] = regions
        routes[name] = entry

    text = context if context is not None else application.get("context")
    # NaN and Infinity are not JSON, which PHP and Node refuse; an integer stays an int of Python (HY-44).
    value = None if text is None else json.loads(text, parse_constant=_reject)

    def context_handler(selection: object) -> object:
        calls.append("context")
        selections.append(selection)
        return value

    def on_response(request, response, elapsed, reply, failure) -> None:
        if failures is not None:
            failures.append(failure)

    return App.open(
        manifest=str(manifest),
        program=str(program),
        handlers={"routes": routes}
        if shared is None
        else {"shared": shared_data, "routes": routes},
        timezone="+09:00",
        context=context_handler if text is not None else None,
        on_response=on_response,
    )
