"""The fixture application of the PHP and Node tests, served by the Python server: its handlers (the same routes and
the same data as `AppTest.php` and `app.test.ts`) and the opening of the application with a counter service."""

from __future__ import annotations

from polyspec.hyper.app import App
from polyspec.hyper.reply import Reply
from polyspec.hyper.request import Request
from polyspec.hyper.result import BadRequest, Forbidden, NotFound, Redirect, Result

from .fixture_app import FIXTURES, PROGRAM


class Counter:
    """A service that the fixture application reads and changes."""

    def __init__(self):
        self.count = 0
        self.actions = 0


def _add(request: Request, reply: Reply, counter: Counter) -> Result:
    counter.actions += 1
    name = request.form_string("name")
    if name == "closed":
        reply.note("refusal", "action").note("kind", "closed").note("refusal", "closed")
        raise Forbidden()
    if name == "unreadable":
        raise BadRequest()
    if name == "taken":
        return Result.page(409, {"name": "taken", "error": "conflict"})
    if name == "preview":
        return Result.page(200, {"name": "preview"})
    if name == "in-place":
        reply.status(403)
        return Result.page(200, {"name": "in-place"})
    if name == "in-place-refused":
        reply.status(403)
        return Result.invalid({"name": "in-place-refused", "error": "empty"})
    if name == "":
        return Result.invalid({"name": "", "error": "empty"})
    if name == "sign-in":
        reply.renew_session()
        return Result.redirect("/").flash_value("note", "renewed")
    if name == "sign-in-page":
        reply.renew_session()
        return Result.page(200, {"name": "renewed"})
    counter.count += 1
    return Result.redirect("/").flash_value("note", "added").changed("count")


def _rows(request: Request, reply: Reply, counter: Counter) -> dict:
    # HY-92: the query embed=1 makes the document embed its data.
    if request.query_int("embed", 0) == 1:
        reply.embed_data()
    return {
        "items": ["a<", f"b{counter.count}"],
        "open": False,
        "mode": "a",
        "view": "x",
        "filter": {"a": 1},
        "tags": [],
    }


def _item(request: Request, reply: Reply) -> dict:
    match request.param("id"):
        case "member":
            reply.cookie("member", "token.1", 3600).remove_cookie("old").cache_control(
                "private, max-age=60"
            )
            return {"id": "member"}
        case "guarded":
            reply.remove_cookie("member")
            raise Forbidden()
        case "bad-cookie":
            reply.cookie("hy-keep", "x")
            return {"id": "x"}
        case "referrer":
            reply.referrer_policy("same-origin")
            return {"id": "referrer"}
        case "referrer-in-place":
            reply.status(403).referrer_policy("origin")
            return {"id": "referrer-in-place"}
        case "missing":
            raise NotFound()
        case "private":
            reply.note("refusal", "private")
            raise Forbidden()
        case "unreadable":
            raise BadRequest()
        case "in-place":
            reply.status(403).cache_control("private, max-age=60")
            return {"id": "in-place"}
        case "in-place-moved":
            reply.status(403)
            raise Redirect(Result.redirect("/items/new"))
        case "other-status":
            reply.status(404)
            return {"id": "other-status"}
        case "moved":
            raise Redirect(Result.redirect("/items/new").flash_value("note", "moved"))
        case "broken":
            reply.note("stage", "load")
            raise RuntimeError("secret detail /srv/app.py")
        case "renew":
            reply.renew_session()
            return {"id": "renew"}
        case "huge":
            return {"id": 2**63 - 1}
        case "huge-float":
            return {"id": 1e20}
        case "numeric":
            return {"labels": {"5": "x"}, "id": "n"}
        case "secret":
            return {"id": "s", "password": "p", "nested": {"a": 1}}
        case other:
            return {"id": other}


def _side(request: Request, counter: Counter) -> dict:
    return {"count": counter.count, "note": request.flash("note")}


def _home(counter: Counter) -> dict:
    return {"name": f"n{counter.count}"}


def handlers() -> dict:
    return {
        "regions": {"side": _side},
        "routes": {
            "home": {"load": _home},
            "add": {"post": _add},
            "list": {"regions": {"rows": _rows}},
            "item": {"load": _item},
        },
    }


def fixture_app(counter: Counter, base_path: str = "", **options) -> App:
    """Opens the fixture application with `counter` as its service; `options` are further arguments of `App.open`."""
    options.setdefault("handlers", handlers())
    application = App.open(
        manifest=str(FIXTURES / "app.json"),
        program=str(PROGRAM),
        timezone="+09:00",
        base_path=base_path,
        **options,
    )
    application.bind(Counter, lambda: counter)
    return application
