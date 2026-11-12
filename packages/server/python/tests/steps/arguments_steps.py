# The steps of contracts/arguments.json (HY-106.8): a call of a public member with too few or too many arguments, or
# with a name that is no parameter, fails with the count error, and a call with its required or all its arguments runs.
# Each member has one row with its written call, so that the check of the stated members reads it.
import inspect
import tempfile
from collections.abc import Callable
from pathlib import Path

from polyspec.hyper.server.app import App
from polyspec.hyper.server.array_session import ArraySession
from polyspec.hyper.server.asgi import create_asgi
from polyspec.hyper.server.bad_request import BadRequest
from polyspec.hyper.server.choice import Choice
from polyspec.hyper.server.client_rendering import ClientRendering
from polyspec.hyper.server.container import Container
from polyspec.hyper.server.file_sessions import FileSessions
from polyspec.hyper.server.forbidden import Forbidden
from polyspec.hyper.server.media_type import MediaType
from polyspec.hyper.server.not_found import NotFound
from polyspec.hyper.server.redirect import Redirect
from polyspec.hyper.server.redis_sessions import RedisSessions
from polyspec.hyper.server.reply import Reply
from polyspec.hyper.server.representation import Representation
from polyspec.hyper.server.request import Request
from polyspec.hyper.server.response import Response
from polyspec.hyper.server.result import Result
from polyspec.hyper.server.server import create_server
from polyspec.hyper.server.uploaded_file import UploadedFile
from polyspec.hyper.server.wsgi import create_wsgi

from ..render.fixture_app import FIXTURES, PROGRAM
from ..render.fixture_handlers import Counter, fixture_app, handlers

_URLENCODED = "application/x-www-form-urlencoded"
_LIMIT = 8 * 1024 * 1024


class _Row:
    """One member: the member itself, whose parameters the step reads, its written call, the values of all its
    arguments in the order of its parameters, the receiver of a method and what releases the result of a call that
    ran. `named` marks a member whose arguments Node takes as one options record (HY-106.9)."""

    def __init__(
        self,
        member: Callable,
        call: Callable[[object, list, dict], object],
        values: Callable[[str], list] = lambda directory: [],
        receiver: Callable[[], object] | None = None,
        release: Callable[[object], None] | None = None,
        named: bool = False,
    ) -> None:
        self.member = member
        self.call = call
        self.values = values
        self.receiver = receiver
        self.release = release
        self.named = named

    def parameters(self) -> tuple[list[str], int]:
        """The names of the parameters of the member without `self`, and how many of them a call must give."""
        declared = [
            parameter
            for parameter in inspect.signature(self.member).parameters.values()
            if parameter.name != "self"
            and parameter.kind is not inspect.Parameter.VAR_POSITIONAL
        ]
        required = sum(
            1 for parameter in declared if parameter.default is inspect.Parameter.empty
        )
        return [parameter.name for parameter in declared], required


def _request() -> Request:
    return Request("GET", "/", media="text/html")


def _result() -> Result:
    return Result.page(200, {})


def _file() -> UploadedFile:
    return UploadedFile("f", "a.txt", "text/plain", b"x")


def _media() -> MediaType:
    return MediaType({}, "application/json")


def _response() -> Response:
    return Response(200, {}, "")


def _application() -> App:
    return fixture_app(Counter())


def _no_command(name: str, *args: object) -> object:
    raise LookupError(f"the store sent the command {name}")


def _not_chosen(request: Request) -> Choice:
    return Choice(False, None)


def _hosted(directory: str) -> list:
    """The first arguments of a host entry: the fixture application and a store of session files."""
    return [_application(), FileSessions(directory)]


def _open_values(directory: str) -> list:
    return [
        str(FIXTURES / "app.json"),
        str(PROGRAM),
        handlers(),
        "+09:00",
        "",
        False,
        "'self'",
        _LIMIT,
        [_URLENCODED],
        None,
        _LIMIT,
        None,
        1000,
        None,
        None,
        None,
        None,
        None,
    ]


def _request_values(directory: str) -> list:
    return ["GET", "/", {}, "", b"", {}, "", {}, {}, False, None, None, "text/html", None, None]  # fmt: skip


_ROWS: dict[str, _Row] = {
    "app.open": _Row(
        App.open,
        lambda receiver, arguments, named: App.open(*arguments, **named),
        _open_values,
        named=True,
    ),
    "app.bind": _Row(
        App.bind,
        lambda receiver, arguments, named: receiver.bind(*arguments, **named),
        lambda directory: [Counter, Counter],
        _application,
    ),
    "app.handle": _Row(
        App.handle,
        lambda receiver, arguments, named: receiver.handle(*arguments, **named),
        lambda directory: [_request(), ArraySession(), 0],
        _application,
    ),
    "media-type.constructor": _Row(
        MediaType,
        lambda receiver, arguments, named: MediaType(*arguments, **named),
        lambda directory: [{}, "application/json"],
    ),
    "media-type.parameters": _Row(
        MediaType.parameters,
        lambda receiver, arguments, named: receiver.parameters(*arguments, **named),
        receiver=_media,
    ),
    "media-type.etag": _Row(
        MediaType.etag,
        lambda receiver, arguments, named: receiver.etag(*arguments, **named),
        lambda directory: ["x"],
        _media,
    ),
    "server.createServer": _Row(
        create_server,
        lambda receiver, arguments, named: create_server(*arguments, **named),
        lambda directory: [*_hosted(directory), None, "127.0.0.1", 0, None, None],
        release=lambda created: created.server_close(),
    ),
    "wsgi.createWsgi": _Row(
        create_wsgi,
        lambda receiver, arguments, named: create_wsgi(*arguments, **named),
        lambda directory: [*_hosted(directory), None, None, None],
    ),
    "asgi.createAsgi": _Row(
        create_asgi,
        lambda receiver, arguments, named: create_asgi(*arguments, **named),
        lambda directory: [*_hosted(directory), None, None, None],
    ),
    "request.constructor": _Row(
        Request,
        lambda receiver, arguments, named: Request(*arguments, **named),
        _request_values,
        named=True,
    ),
    "request.withHeader": _Row(
        Request.with_header,
        lambda receiver, arguments, named: receiver.with_header(*arguments, **named),
        lambda directory: ["X-A", "b"],
        _request,
    ),
    "request.json": _Row(
        Request.json,
        lambda receiver, arguments, named: receiver.json(*arguments, **named),
        receiver=_request,
    ),
    "request.selection": _Row(
        Request.selection,
        lambda receiver, arguments, named: receiver.selection(*arguments, **named),
        receiver=_request,
    ),
    "request.params": _Row(
        Request.params,
        lambda receiver, arguments, named: receiver.params(*arguments, **named),
        receiver=_request,
    ),
    "request.cookie": _Row(
        Request.cookie,
        lambda receiver, arguments, named: receiver.cookie(*arguments, **named),
        lambda directory: ["a"],
        _request,
    ),
    "request.param": _Row(
        Request.param,
        lambda receiver, arguments, named: receiver.param(*arguments, **named),
        lambda directory: ["a"],
        _request,
    ),
    "request.validInput": _Row(
        Request.valid_input,
        lambda receiver, arguments, named: receiver.valid_input(*arguments, **named),
        receiver=_request,
    ),
    "request.bodySize": _Row(
        Request.body_size,
        lambda receiver, arguments, named: receiver.body_size(*arguments, **named),
        receiver=_request,
    ),
    "request.mediaType": _Row(
        Request.media_type,
        lambda receiver, arguments, named: receiver.media_type(*arguments, **named),
        receiver=_request,
    ),
    "request.header": _Row(
        Request.header,
        lambda receiver, arguments, named: receiver.header(*arguments, **named),
        lambda directory: ["a"],
        _request,
    ),
    "request.wantsJson": _Row(
        Request.wants_json,
        lambda receiver, arguments, named: receiver.wants_json(*arguments, **named),
        receiver=_request,
    ),
    "request.isRegionRequest": _Row(
        Request.is_region_request,
        lambda receiver, arguments, named: receiver.is_region_request(
            *arguments, **named
        ),
        receiver=_request,
    ),
    "request.currentPath": _Row(
        Request.current_path,
        lambda receiver, arguments, named: receiver.current_path(*arguments, **named),
        receiver=_request,
    ),
    "request.path": _Row(
        Request.path,
        lambda receiver, arguments, named: receiver.path(*arguments, **named),
        receiver=_request,
    ),
    "request.rawQuery": _Row(
        Request.raw_query,
        lambda receiver, arguments, named: receiver.raw_query(*arguments, **named),
        receiver=_request,
    ),
    "request.query": _Row(
        Request.query,
        lambda receiver, arguments, named: receiver.query(*arguments, **named),
        receiver=_request,
    ),
    "request.queryInt": _Row(
        Request.query_int,
        lambda receiver, arguments, named: receiver.query_int(*arguments, **named),
        lambda directory: ["a", 0],
        _request,
    ),
    "request.form": _Row(
        Request.form,
        lambda receiver, arguments, named: receiver.form(*arguments, **named),
        receiver=_request,
    ),
    "request.formString": _Row(
        Request.form_string,
        lambda receiver, arguments, named: receiver.form_string(*arguments, **named),
        lambda directory: ["a"],
        _request,
    ),
    "request.files": _Row(
        Request.files,
        lambda receiver, arguments, named: receiver.files(*arguments, **named),
        receiver=_request,
    ),
    "request.file": _Row(
        Request.file,
        lambda receiver, arguments, named: receiver.file(*arguments, **named),
        lambda directory: ["a"],
        _request,
    ),
    "request.fileOver": _Row(
        Request.file_over,
        lambda receiver, arguments, named: receiver.file_over(*arguments, **named),
        lambda directory: [1],
        _request,
    ),
    "request.flash": _Row(
        Request.flash,
        lambda receiver, arguments, named: receiver.flash(*arguments, **named),
        lambda directory: ["a"],
        _request,
    ),
    "request.browser": _Row(
        Request.browser,
        lambda receiver, arguments, named: receiver.browser(*arguments, **named),
        receiver=_request,
    ),
    "request.csrfToken": _Row(
        Request.csrf_token,
        lambda receiver, arguments, named: receiver.csrf_token(*arguments, **named),
        receiver=_request,
    ),
    "request.targetPath": _Row(
        Request.target_path,
        lambda receiver, arguments, named: Request.target_path(*arguments, **named),
        lambda directory: ["/a?b"],
    ),
    "request.targetQuery": _Row(
        Request.target_query,
        lambda receiver, arguments, named: Request.target_query(*arguments, **named),
        lambda directory: ["/a?b"],
    ),
    "reply.note": _Row(
        Reply.note,
        lambda receiver, arguments, named: receiver.note(*arguments, **named),
        lambda directory: ["a", 1],
        Reply,
    ),
    "reply.notes": _Row(
        Reply.notes,
        lambda receiver, arguments, named: receiver.notes(*arguments, **named),
        receiver=Reply,
    ),
    "reply.cookie": _Row(
        Reply.cookie,
        lambda receiver, arguments, named: receiver.cookie(*arguments, **named),
        lambda directory: ["a", "b", 60],
        Reply,
    ),
    "reply.removeCookie": _Row(
        Reply.remove_cookie,
        lambda receiver, arguments, named: receiver.remove_cookie(*arguments, **named),
        lambda directory: ["a"],
        Reply,
    ),
    "reply.cacheControl": _Row(
        Reply.cache_control,
        lambda receiver, arguments, named: receiver.cache_control(*arguments, **named),
        lambda directory: ["no-store"],
        Reply,
    ),
    "reply.renewSession": _Row(
        Reply.renew_session,
        lambda receiver, arguments, named: receiver.renew_session(*arguments, **named),
        receiver=Reply,
    ),
    "reply.referrerPolicy": _Row(
        Reply.referrer_policy,
        lambda receiver, arguments, named: receiver.referrer_policy(
            *arguments, **named
        ),
        lambda directory: ["no-referrer"],
        Reply,
    ),
    "reply.status": _Row(
        Reply.status,
        lambda receiver, arguments, named: receiver.status(*arguments, **named),
        lambda directory: [403],
        Reply,
    ),
    "reply.embedData": _Row(
        Reply.embed_data,
        lambda receiver, arguments, named: receiver.embed_data(*arguments, **named),
        receiver=Reply,
    ),
    "response.constructor": _Row(
        Response,
        lambda receiver, arguments, named: Response(*arguments, **named),
        lambda directory: [200, {}, ""],
    ),
    "response.withHeader": _Row(
        Response.with_header,
        lambda receiver, arguments, named: receiver.with_header(*arguments, **named),
        lambda directory: ["X-A", "b"],
        _response,
    ),
    "response.text": _Row(
        Response.text,
        lambda receiver, arguments, named: Response.text(*arguments, **named),
        lambda directory: [200, "x"],
    ),
    "result.redirect": _Row(
        Result.redirect,
        lambda receiver, arguments, named: Result.redirect(*arguments, **named),
        lambda directory: ["/a"],
    ),
    "result.page": _Row(
        Result.page,
        lambda receiver, arguments, named: Result.page(*arguments, **named),
        lambda directory: [200, {}],
    ),
    "result.invalid": _Row(
        Result.invalid,
        lambda receiver, arguments, named: Result.invalid(*arguments, **named),
        lambda directory: [{}],
    ),
    "result.flash": _Row(
        Result.flash,
        lambda receiver, arguments, named: receiver.flash(*arguments, **named),
        lambda directory: ["a", 1],
        _result,
    ),
    "result.changed": _Row(
        Result.changed,
        lambda receiver, arguments, named: receiver.changed(*arguments, **named),
        lambda directory: ["a", "b"],
        _result,
    ),
    "redirect.constructor": _Row(
        Redirect,
        lambda receiver, arguments, named: Redirect(*arguments, **named),
        lambda directory: [Result.redirect("/a")],
    ),
    "not-found.constructor": _Row(
        NotFound, lambda receiver, arguments, named: NotFound(*arguments, **named)
    ),
    "forbidden.constructor": _Row(
        Forbidden, lambda receiver, arguments, named: Forbidden(*arguments, **named)
    ),
    "bad-request.constructor": _Row(
        BadRequest, lambda receiver, arguments, named: BadRequest(*arguments, **named)
    ),
    "uploaded-file.constructor": _Row(
        UploadedFile,
        lambda receiver, arguments, named: UploadedFile(*arguments, **named),
        lambda directory: ["f", "a.txt", "text/plain", b"x"],
    ),
    "uploaded-file.name": _Row(
        UploadedFile.name,
        lambda receiver, arguments, named: receiver.name(*arguments, **named),
        receiver=_file,
    ),
    "uploaded-file.filename": _Row(
        UploadedFile.filename,
        lambda receiver, arguments, named: receiver.filename(*arguments, **named),
        receiver=_file,
    ),
    "uploaded-file.contentType": _Row(
        UploadedFile.content_type,
        lambda receiver, arguments, named: receiver.content_type(*arguments, **named),
        receiver=_file,
    ),
    "uploaded-file.size": _Row(
        UploadedFile.size,
        lambda receiver, arguments, named: receiver.size(*arguments, **named),
        receiver=_file,
    ),
    "uploaded-file.content": _Row(
        UploadedFile.content,
        lambda receiver, arguments, named: receiver.content(*arguments, **named),
        receiver=_file,
    ),
    "uploaded-file.moveTo": _Row(
        UploadedFile.move_to,
        lambda receiver, arguments, named: receiver.move_to(*arguments, **named),
        lambda directory: [str(Path(directory) / "moved.txt")],
        _file,
    ),
    "container.bind": _Row(
        Container.bind,
        lambda receiver, arguments, named: receiver.bind(*arguments, **named),
        lambda directory: [Counter, Counter],
        Container,
    ),
    "container.call": _Row(
        Container.call,
        lambda receiver, arguments, named: receiver.call(*arguments, **named),
        lambda directory: [Counter, {}],
        Container,
    ),
    "array-session.constructor": _Row(
        ArraySession,
        lambda receiver, arguments, named: ArraySession(*arguments, **named),
    ),
    "array-session.get": _Row(
        ArraySession.get,
        lambda receiver, arguments, named: receiver.get(*arguments, **named),
        lambda directory: ["a"],
        ArraySession,
    ),
    "array-session.set": _Row(
        ArraySession.set,
        lambda receiver, arguments, named: receiver.set(*arguments, **named),
        lambda directory: ["a", 1],
        ArraySession,
    ),
    "array-session.remove": _Row(
        ArraySession.remove,
        lambda receiver, arguments, named: receiver.remove(*arguments, **named),
        lambda directory: ["a"],
        ArraySession,
    ),
    "array-session.renew": _Row(
        ArraySession.renew,
        lambda receiver, arguments, named: receiver.renew(*arguments, **named),
        receiver=ArraySession,
    ),
    "file-sessions.constructor": _Row(
        FileSessions,
        lambda receiver, arguments, named: FileSessions(*arguments, **named),
        lambda directory: [directory, 1440],
        named=True,
    ),
    "redis-sessions.constructor": _Row(
        RedisSessions,
        lambda receiver, arguments, named: RedisSessions(*arguments, **named),
        lambda directory: [_no_command, 1440, "PHPREDIS_SESSION:", 30, 100, 0.02, None],
        named=True,
    ),
    "client-rendering.constructor": _Row(
        ClientRendering,
        lambda receiver, arguments, named: ClientRendering(*arguments, **named),
        lambda directory: ["shell", "", _not_chosen],
    ),
    "choice.constructor": _Row(
        Choice,
        lambda receiver, arguments, named: Choice(*arguments, **named),
        lambda directory: [True, None],
    ),
    "representation.constructor": _Row(
        Representation,
        lambda receiver, arguments, named: Representation(*arguments, **named),
        lambda directory: [200, None, {}],
    ),
}


def counts(case) -> None:
    """Calls the member of the case with the number of arguments that `call` names, and compares whether the call
    failed with the count error."""
    row = _row(case)
    form = case.input("call")
    with tempfile.TemporaryDirectory(prefix="hyper-arguments-") as directory:
        names, required = row.parameters()
        values = row.values(directory)
        if len(values) < len(names):
            raise LookupError(
                "the row holds fewer values than the member has parameters"
            )
        arguments: list = []
        named: dict = {}
        if form == "missing":
            if required == 0:
                raise LookupError("the member has no required parameter")
            if row.named:
                absent = case.input("parameter")
                if absent not in names[:required]:
                    raise LookupError(
                        f"{absent} is no required parameter of the member"
                    )
                named = {
                    name: value
                    for name, value in zip(names[:required], values, strict=False)
                    if name != absent
                }
            else:
                arguments = values[: required - 1]
        elif form == "required":
            if required == len(values):
                raise LookupError("the member has no optional parameter")
            if row.named:
                named = dict(zip(names[:required], values, strict=False))
            else:
                arguments = values[:required]
        elif form == "all":
            if row.named:
                named = dict(zip(names, values, strict=True))
            else:
                arguments = values
        elif form == "extra":
            arguments = [*values, None]
        else:
            raise LookupError(f"the call {form} of the case is unknown")
        case.compare("refused", _refused(row, arguments, named))


def names(case) -> None:
    """Calls the member of the case with its required arguments and one more under a name that is no parameter, and
    compares whether the call failed with the count error."""
    row = _row(case)
    if not row.named:
        raise LookupError("the member takes no options record")
    with tempfile.TemporaryDirectory(prefix="hyper-arguments-") as directory:
        declared, required = row.parameters()
        named = dict(zip(declared[:required], row.values(directory), strict=False))
        named[case.input("parameter")] = None
        case.compare("refused", _refused(row, [], named))


def _row(case) -> _Row:
    member = case.input("member")
    if member not in _ROWS:
        raise LookupError(f"the member {member} of the case is unknown")
    return _ROWS[member]


def _refused(row: _Row, arguments: list, named: dict) -> bool:
    """Makes the call once and returns whether it failed with the count error: a TypeError that the call itself
    raised, whose traceback ends in the written call. Every other error is raised again."""
    receiver = None if row.receiver is None else row.receiver()
    try:
        result = row.call(receiver, arguments, named)
    except TypeError as error:
        traceback = error.__traceback__
        if (
            type(error) is not TypeError
            or traceback is None
            or traceback.tb_next is None
            or traceback.tb_next.tb_next is not None
        ):
            raise
        return True
    if row.release is not None:
        row.release(result)
    return False
