<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\App;
use Polyspec\Hyper\ArraySession;
use Polyspec\Hyper\BadRequest;
use Polyspec\Hyper\Choice;
use Polyspec\Hyper\ClientRendering;
use Polyspec\Hyper\Container;
use Polyspec\Hyper\Forbidden;
use Polyspec\Hyper\MediaType;
use Polyspec\Hyper\NativeSession;
use Polyspec\Hyper\NotFound;
use Polyspec\Hyper\Redirect;
use Polyspec\Hyper\RedisClusterSessions;
use Polyspec\Hyper\RedisSentinelSessions;
use Polyspec\Hyper\Reply;
use Polyspec\Hyper\Representation;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Response;
use Polyspec\Hyper\Result;
use Polyspec\Hyper\Tests\CaseReader;
use Polyspec\Hyper\Tests\Support\ClientApp;
use Polyspec\Hyper\Tests\Support\Counter;
use Polyspec\Hyper\Tests\Support\Json;
use Polyspec\Hyper\Tests\Support\Untyped;
use Polyspec\Hyper\UploadedFile;

/**
 * HY-106.8, HY-106.16: the cases of contracts/arguments.json, the count and the names of the arguments of a call of a
 * public member.
 */
final class ArgumentsSteps
{
    /** The class and the method of each member of the cases, by the member id. */
    private const SYMBOLS = [
        'app.open' => [App::class, 'open'],
        'app.bind' => [App::class, 'bind'],
        'app.handle' => [App::class, 'handle'],
        'app.run' => [App::class, 'run'],
        'media-type.constructor' => [MediaType::class, '__construct'],
        'media-type.parameters' => [MediaType::class, 'parameters'],
        'media-type.etag' => [MediaType::class, 'etag'],
        'request.constructor' => [Request::class, '__construct'],
        'request.withHeader' => [Request::class, 'withHeader'],
        'request.json' => [Request::class, 'json'],
        'request.selection' => [Request::class, 'selection'],
        'request.params' => [Request::class, 'params'],
        'request.cookie' => [Request::class, 'cookie'],
        'request.param' => [Request::class, 'param'],
        'request.validInput' => [Request::class, 'validInput'],
        'request.bodySize' => [Request::class, 'bodySize'],
        'request.mediaType' => [Request::class, 'mediaType'],
        'request.header' => [Request::class, 'header'],
        'request.wantsJson' => [Request::class, 'wantsJson'],
        'request.isRegionRequest' => [Request::class, 'isRegionRequest'],
        'request.currentPath' => [Request::class, 'currentPath'],
        'request.path' => [Request::class, 'path'],
        'request.rawQuery' => [Request::class, 'rawQuery'],
        'request.query' => [Request::class, 'query'],
        'request.queryInt' => [Request::class, 'queryInt'],
        'request.form' => [Request::class, 'form'],
        'request.formString' => [Request::class, 'formString'],
        'request.files' => [Request::class, 'files'],
        'request.file' => [Request::class, 'file'],
        'request.fileOver' => [Request::class, 'fileOver'],
        'request.flash' => [Request::class, 'flash'],
        'request.csrfToken' => [Request::class, 'csrfToken'],
        'request.browser' => [Request::class, 'browser'],
        'request.targetPath' => [Request::class, 'targetPath'],
        'request.targetQuery' => [Request::class, 'targetQuery'],
        'reply.note' => [Reply::class, 'note'],
        'reply.notes' => [Reply::class, 'notes'],
        'reply.cookie' => [Reply::class, 'cookie'],
        'reply.removeCookie' => [Reply::class, 'removeCookie'],
        'reply.cacheControl' => [Reply::class, 'cacheControl'],
        'reply.renewSession' => [Reply::class, 'renewSession'],
        'reply.referrerPolicy' => [Reply::class, 'referrerPolicy'],
        'reply.status' => [Reply::class, 'status'],
        'reply.embedData' => [Reply::class, 'embedData'],
        'response.constructor' => [Response::class, '__construct'],
        'response.withHeader' => [Response::class, 'withHeader'],
        'response.text' => [Response::class, 'text'],
        'result.redirect' => [Result::class, 'redirect'],
        'result.page' => [Result::class, 'page'],
        'result.invalid' => [Result::class, 'invalid'],
        'result.flash' => [Result::class, 'flash'],
        'result.changed' => [Result::class, 'changed'],
        'redirect.constructor' => [Redirect::class, '__construct'],
        'not-found.constructor' => [NotFound::class, '__construct'],
        'forbidden.constructor' => [Forbidden::class, '__construct'],
        'bad-request.constructor' => [BadRequest::class, '__construct'],
        'uploaded-file.constructor' => [UploadedFile::class, '__construct'],
        'uploaded-file.name' => [UploadedFile::class, 'name'],
        'uploaded-file.filename' => [UploadedFile::class, 'filename'],
        'uploaded-file.contentType' => [UploadedFile::class, 'contentType'],
        'uploaded-file.size' => [UploadedFile::class, 'size'],
        'uploaded-file.content' => [UploadedFile::class, 'content'],
        'uploaded-file.moveTo' => [UploadedFile::class, 'moveTo'],
        'container.bind' => [Container::class, 'bind'],
        'container.call' => [Container::class, 'call'],
        'array-session.constructor' => [ArraySession::class, '__construct'],
        'array-session.get' => [ArraySession::class, 'get'],
        'array-session.set' => [ArraySession::class, 'set'],
        'array-session.remove' => [ArraySession::class, 'remove'],
        'array-session.renew' => [ArraySession::class, 'renew'],
        'native-session.constructor' => [NativeSession::class, '__construct'],
        'native-session.get' => [NativeSession::class, 'get'],
        'native-session.set' => [NativeSession::class, 'set'],
        'native-session.remove' => [NativeSession::class, 'remove'],
        'native-session.renew' => [NativeSession::class, 'renew'],
        'redis-cluster-sessions.constructor' => [RedisClusterSessions::class, '__construct'],
        'redis-cluster-sessions.invoke' => [RedisClusterSessions::class, '__invoke'],
        'redis-cluster-sessions.open' => [RedisClusterSessions::class, 'open'],
        'redis-cluster-sessions.close' => [RedisClusterSessions::class, 'close'],
        'redis-cluster-sessions.validateId' => [RedisClusterSessions::class, 'validateId'],
        'redis-cluster-sessions.updateTimestamp' => [RedisClusterSessions::class, 'updateTimestamp'],
        'redis-cluster-sessions.read' => [RedisClusterSessions::class, 'read'],
        'redis-cluster-sessions.write' => [RedisClusterSessions::class, 'write'],
        'redis-cluster-sessions.destroy' => [RedisClusterSessions::class, 'destroy'],
        'redis-cluster-sessions.gc' => [RedisClusterSessions::class, 'gc'],
        'redis-sentinel-sessions.constructor' => [RedisSentinelSessions::class, '__construct'],
        'redis-sentinel-sessions.invoke' => [RedisSentinelSessions::class, '__invoke'],
        'client-rendering.constructor' => [ClientRendering::class, '__construct'],
        'choice.constructor' => [Choice::class, '__construct'],
        'representation.constructor' => [Representation::class, '__construct'],
    ];

    /** Records whether the call of the member with the arguments of `call` fails with the count error. */
    public static function counts(CaseReader $case): void
    {
        $member = Json::string($case->input('member'));
        $call = Json::string($case->input('call'));
        $parameter = $case->has('parameter') ? Json::string($case->input('parameter')) : null;
        $directory = sys_get_temp_dir() . '/hyper-arguments-' . bin2hex(random_bytes(6));
        mkdir($directory);
        try {
            $all = self::arguments($member, "{$directory}/moved");
            $required = self::required($member);
            $named = !array_is_list($all);
            if ($parameter !== null && (!$named || $call !== 'missing')) {
                throw new \UnexpectedValueException(
                    'a case names a parameter of a call that leaves none out by its name',
                );
            }
            if ($call === 'missing' && $required === 0) {
                throw new \UnexpectedValueException("the member {$member} has no required parameter");
            }
            if ($call === 'required' && $required === count($all)) {
                throw new \UnexpectedValueException("the member {$member} has no optional parameter");
            }
            $least = array_slice($all, 0, $required, true);
            $arguments = match ($call) {
                'missing' => $named
                    ? array_diff_key($least, [$parameter ?? array_key_last($least) => true])
                    : array_slice($all, 0, $required - 1),
                'required' => $least,
                'all' => $all,
                'extra' => [...array_values($all), null],
                default => throw new \UnexpectedValueException("the call {$call} of the case is unknown"),
            };
            $case->compare('refused', self::refused($member, $arguments, static fn (\Throwable $error): bool => (
                $error::class === \ArgumentCountError::class
            )));
        } finally {
            if (is_file("{$directory}/moved")) {
                unlink("{$directory}/moved");
            }
            rmdir($directory);
        }
    }

    /** Records whether the call with the required parameters and one more named argument fails with the error. */
    public static function names(CaseReader $case): void
    {
        $member = Json::string($case->input('member'));
        $all = self::arguments($member, '');
        if (array_is_list($all)) {
            throw new \UnexpectedValueException("the member {$member} takes no named arguments in the cases");
        }
        $arguments = [
            ...array_slice($all, 0, self::required($member), true),
            Json::string($case->input('parameter')) => null,
        ];
        $case->compare('refused', self::refused($member, $arguments, static fn (\Throwable $error): bool => (
            $error::class === \Error::class && str_starts_with($error->getMessage(), 'Unknown named parameter')
        )));
    }

    /**
     * Builds the receiver, makes the call once and returns whether it failed with the error that `$counts` tells;
     * every other error is thrown again.
     *
     * @param array<array-key, mixed> $arguments
     * @param \Closure(\Throwable): bool $counts
     */
    private static function refused(string $member, array $arguments, \Closure $counts): bool
    {
        $receiver = self::receiver($member);
        try {
            self::call($member, $receiver, $arguments);
        } catch (\Throwable $error) {
            if ($counts($error)) {
                return true;
            }

            throw $error;
        }

        return false;
    }

    /** Returns the number of required parameters of a member, as PHP declares it. */
    private static function required(string $member): int
    {
        [$class, $name] = self::SYMBOLS[$member] ?? throw new \UnexpectedValueException(
            "the member {$member} of the case is unknown",
        );

        return (new \ReflectionMethod($class, $name))->getNumberOfRequiredParameters();
    }

    private static function request(): Request
    {
        return new Request('GET', '/', media: 'text/html');
    }

    /** Returns a new receiver of a method of a member, or null for a static member and a constructor. */
    private static function receiver(string $member): ?object
    {
        [$unit, $name] = explode('.', $member, 2);
        $static = [
            'app.open',
            'request.targetPath',
            'request.targetQuery',
            'response.text',
            'result.redirect',
            'result.page',
            'result.invalid',
        ];
        if ($name === 'constructor' || in_array($member, $static, true)) {
            return null;
        }

        return match ($unit) {
            'app' => ClientApp::open(
                new ClientRendering(ClientApp::SHELL, '/_props', static fn (): Choice => new Choice(false, null)),
                new Counter(),
            ),
            'request' => self::request(),
            'reply' => new Reply(),
            'response' => new Response(200, [], ''),
            'result' => Result::page(200, []),
            'media-type' => new MediaType([], 'application/json'),
            'uploaded-file' => new UploadedFile('f', 'a.txt', 'text/plain', 'x'),
            'container' => new Container(),
            'array-session' => new ArraySession(),
            // The cases of these methods fail before the body reads the object.
            'native-session' => self::unmade(NativeSession::class),
            'redis-cluster-sessions' => self::unmade(RedisClusterSessions::class),
            'redis-sentinel-sessions' => self::unmade(RedisSentinelSessions::class),
            default => throw new \UnexpectedValueException("the member {$member} of the case is unknown"),
        };
    }

    /**
     * Returns an object of the class whose constructor did not run.
     *
     * @param class-string $class
     */
    private static function unmade(string $class): object
    {
        return (new \ReflectionClass($class))->newInstanceWithoutConstructor();
    }

    /**
     * Returns every valid argument of a member in the order of its parameters; the members that the Node server takes
     * as one options record have theirs by name (HY-106.9).
     *
     * @return array<array-key, mixed>
     */
    private static function arguments(string $member, string $path): array
    {
        $service = static fn (): Counter => new Counter();

        return match ($member) {
            'app.open' => [
                'manifest' => ClientApp::MANIFEST,
                'program' => ClientApp::PROGRAM,
                'handlers' => ClientApp::handlers(),
                'timezone' => '+09:00',
                'basePath' => '',
                'https' => false,
                'frameAncestors' => "'self'",
                'bodyLimit' => 8388608,
                'formTypes' => ['application/x-www-form-urlencoded'],
                'fileLimit' => null,
                'responseLimit' => 8388608,
                'valueLimit' => null,
                'partLimit' => 1000,
                'onResponse' => null,
                'clientRendering' => null,
                'onDisconnect' => null,
                'written' => null,
                'around' => null,
                'sessionSetup' => null,
                'context' => null,
                'functions' => [],
            ],
            'request.constructor' => [
                'method' => 'GET',
                'path' => '/',
                'headers' => [],
                'query' => '',
                'body' => '',
                'flash' => [],
                'csrfToken' => '',
                'params' => [],
                'cookies' => [],
                'https' => false,
                'selection' => null,
                'bodySize' => null,
                'media' => 'text/html',
                'read' => null,
                'json' => null,
            ],
            'app.bind', 'container.bind' => [Counter::class, $service],
            'app.handle' => [self::request(), new ArraySession(), 0],
            'app.run' => [0],
            'media-type.constructor' => [[], 'application/json'],
            'media-type.etag' => ['x'],
            'request.withHeader', 'response.withHeader' => ['X-A', 'b'],
            'request.cookie', 'request.param', 'request.header', 'request.formString', 'request.file', 'request.flash',
            'reply.removeCookie', 'array-session.get', 'array-session.remove', 'native-session.get',
            'native-session.remove', 'redis-cluster-sessions.validateId', 'redis-cluster-sessions.read',
            'redis-cluster-sessions.destroy' => ['a'],
            'request.queryInt' => ['a', 0],
            'request.fileOver', 'redis-cluster-sessions.gc' => [1],
            'request.targetPath', 'request.targetQuery' => ['/a?b'],
            'reply.note', 'result.flash', 'array-session.set', 'native-session.set' => ['a', 1],
            'reply.cookie' => ['a', 'b', 60],
            'reply.cacheControl' => ['no-store'],
            'reply.referrerPolicy' => ['no-referrer'],
            'reply.status' => [403],
            'response.constructor' => [200, [], ''],
            'response.text' => [200, 'x'],
            'result.redirect' => ['/a'],
            'result.page' => [200, []],
            'result.invalid' => [[]],
            'result.changed' => ['a', 'b'],
            'redirect.constructor' => [Result::redirect('/a')],
            'uploaded-file.constructor' => ['f', 'a.txt', 'text/plain', 'x'],
            'uploaded-file.moveTo' => [$path],
            'container.call' => [static fn (): null => null, []],
            'native-session.constructor' => [false, self::request(), null],
            'redis-cluster-sessions.constructor' => [['127.0.0.1:1'], 30, 100, 20000, 1.0, null, null],
            'redis-cluster-sessions.open', 'redis-cluster-sessions.updateTimestamp',
            'redis-cluster-sessions.write' => ['a', 'a'],
            'redis-sentinel-sessions.constructor' => [[['host' => '127.0.0.1', 'port' => 1]], 'hyper', '', 'tcp', 0.5],
            'client-rendering.constructor' => [
                'shell',
                '',
                static fn (Request $request): Choice => new Choice(false, null),
            ],
            'choice.constructor' => [true, null],
            'representation.constructor' => [200, null, []],
            default => array_key_exists($member, self::SYMBOLS)
                ? []
                : throw new \UnexpectedValueException("the member {$member} of the case is unknown"),
        };
    }

    /**
     * Makes the written call of a member; a string key of the arguments is a named argument. The case gives a number of
     * arguments that the declaration does not take, so each call is made without the types of its parameters.
     *
     * @param array<array-key, mixed> $arguments
     */
    private static function call(string $member, ?object $receiver, array $arguments): mixed
    {
        return match (true) {
            $receiver === null => self::made($member, $arguments),
            $receiver instanceof App => match ($member) {
                'app.bind' => Untyped::call($receiver->bind(...))(...$arguments),
                'app.handle' => Untyped::call($receiver->handle(...))(...$arguments),
                'app.run' => Untyped::call($receiver->run(...))(...$arguments),
                default => throw new \UnexpectedValueException("the member {$member} of the case is unknown"),
            },
            $receiver instanceof Request => match ($member) {
                'request.withHeader' => Untyped::call($receiver->withHeader(...))(...$arguments),
                'request.json' => Untyped::call($receiver->json(...))(...$arguments),
                'request.selection' => Untyped::call($receiver->selection(...))(...$arguments),
                'request.params' => Untyped::call($receiver->params(...))(...$arguments),
                'request.cookie' => Untyped::call($receiver->cookie(...))(...$arguments),
                'request.param' => Untyped::call($receiver->param(...))(...$arguments),
                'request.validInput' => Untyped::call($receiver->validInput(...))(...$arguments),
                'request.bodySize' => Untyped::call($receiver->bodySize(...))(...$arguments),
                'request.mediaType' => Untyped::call($receiver->mediaType(...))(...$arguments),
                'request.header' => Untyped::call($receiver->header(...))(...$arguments),
                'request.wantsJson' => Untyped::call($receiver->wantsJson(...))(...$arguments),
                'request.isRegionRequest' => Untyped::call($receiver->isRegionRequest(...))(...$arguments),
                'request.currentPath' => Untyped::call($receiver->currentPath(...))(...$arguments),
                'request.path' => Untyped::call($receiver->path(...))(...$arguments),
                'request.rawQuery' => Untyped::call($receiver->rawQuery(...))(...$arguments),
                'request.query' => Untyped::call($receiver->query(...))(...$arguments),
                'request.queryInt' => Untyped::call($receiver->queryInt(...))(...$arguments),
                'request.form' => Untyped::call($receiver->form(...))(...$arguments),
                'request.formString' => Untyped::call($receiver->formString(...))(...$arguments),
                'request.files' => Untyped::call($receiver->files(...))(...$arguments),
                'request.file' => Untyped::call($receiver->file(...))(...$arguments),
                'request.fileOver' => Untyped::call($receiver->fileOver(...))(...$arguments),
                'request.flash' => Untyped::call($receiver->flash(...))(...$arguments),
                'request.csrfToken' => Untyped::call($receiver->csrfToken(...))(...$arguments),
                'request.browser' => Untyped::call($receiver->browser(...))(...$arguments),
                default => throw new \UnexpectedValueException("the member {$member} of the case is unknown"),
            },
            $receiver instanceof Reply => match ($member) {
                'reply.note' => Untyped::call($receiver->note(...))(...$arguments),
                'reply.notes' => Untyped::call($receiver->notes(...))(...$arguments),
                'reply.cookie' => Untyped::call($receiver->cookie(...))(...$arguments),
                'reply.removeCookie' => Untyped::call($receiver->removeCookie(...))(...$arguments),
                'reply.cacheControl' => Untyped::call($receiver->cacheControl(...))(...$arguments),
                'reply.renewSession' => Untyped::call($receiver->renewSession(...))(...$arguments),
                'reply.referrerPolicy' => Untyped::call($receiver->referrerPolicy(...))(...$arguments),
                'reply.status' => Untyped::call($receiver->status(...))(...$arguments),
                'reply.embedData' => Untyped::call($receiver->embedData(...))(...$arguments),
                default => throw new \UnexpectedValueException("the member {$member} of the case is unknown"),
            },
            $receiver instanceof Response => Untyped::call($receiver->withHeader(...))(...$arguments),
            $receiver instanceof Result => match ($member) {
                'result.flash' => Untyped::call($receiver->flash(...))(...$arguments),
                'result.changed' => Untyped::call($receiver->changed(...))(...$arguments),
                default => throw new \UnexpectedValueException("the member {$member} of the case is unknown"),
            },
            $receiver instanceof MediaType => match ($member) {
                'media-type.parameters' => Untyped::call($receiver->parameters(...))(...$arguments),
                'media-type.etag' => Untyped::call($receiver->etag(...))(...$arguments),
                default => throw new \UnexpectedValueException("the member {$member} of the case is unknown"),
            },
            $receiver instanceof UploadedFile => match ($member) {
                'uploaded-file.name' => Untyped::call($receiver->name(...))(...$arguments),
                'uploaded-file.filename' => Untyped::call($receiver->filename(...))(...$arguments),
                'uploaded-file.contentType' => Untyped::call($receiver->contentType(...))(...$arguments),
                'uploaded-file.size' => Untyped::call($receiver->size(...))(...$arguments),
                'uploaded-file.content' => Untyped::call($receiver->content(...))(...$arguments),
                'uploaded-file.moveTo' => Untyped::call($receiver->moveTo(...))(...$arguments),
                default => throw new \UnexpectedValueException("the member {$member} of the case is unknown"),
            },
            $receiver instanceof Container => match ($member) {
                'container.bind' => Untyped::call($receiver->bind(...))(...$arguments),
                'container.call' => Untyped::call($receiver->call(...))(...$arguments),
                default => throw new \UnexpectedValueException("the member {$member} of the case is unknown"),
            },
            $receiver instanceof ArraySession => match ($member) {
                'array-session.get' => Untyped::call($receiver->get(...))(...$arguments),
                'array-session.set' => Untyped::call($receiver->set(...))(...$arguments),
                'array-session.remove' => Untyped::call($receiver->remove(...))(...$arguments),
                'array-session.renew' => Untyped::call($receiver->renew(...))(...$arguments),
                default => throw new \UnexpectedValueException("the member {$member} of the case is unknown"),
            },
            $receiver instanceof NativeSession => match ($member) {
                'native-session.get' => Untyped::call($receiver->get(...))(...$arguments),
                'native-session.set' => Untyped::call($receiver->set(...))(...$arguments),
                'native-session.remove' => Untyped::call($receiver->remove(...))(...$arguments),
                'native-session.renew' => Untyped::call($receiver->renew(...))(...$arguments),
                default => throw new \UnexpectedValueException("the member {$member} of the case is unknown"),
            },
            $receiver instanceof RedisClusterSessions => match ($member) {
                'redis-cluster-sessions.invoke' => Untyped::call($receiver->__invoke(...))(...$arguments),
                'redis-cluster-sessions.open' => Untyped::call($receiver->open(...))(...$arguments),
                'redis-cluster-sessions.close' => Untyped::call($receiver->close(...))(...$arguments),
                'redis-cluster-sessions.validateId' => Untyped::call($receiver->validateId(...))(...$arguments),
                'redis-cluster-sessions.updateTimestamp' => Untyped::call(
                    $receiver->updateTimestamp(...),
                )(...$arguments),
                'redis-cluster-sessions.read' => Untyped::call($receiver->read(...))(...$arguments),
                'redis-cluster-sessions.write' => Untyped::call($receiver->write(...))(...$arguments),
                'redis-cluster-sessions.destroy' => Untyped::call($receiver->destroy(...))(...$arguments),
                'redis-cluster-sessions.gc' => Untyped::call($receiver->gc(...))(...$arguments),
                default => throw new \UnexpectedValueException("the member {$member} of the case is unknown"),
            },
            $receiver instanceof RedisSentinelSessions => Untyped::call($receiver->__invoke(...))(...$arguments),
            default => throw new \UnexpectedValueException("the member {$member} of the case is unknown"),
        };
    }

    /**
     * Makes the written call of a static member or of a constructor.
     *
     * @param array<array-key, mixed> $arguments
     */
    private static function made(string $member, array $arguments): mixed
    {
        return match ($member) {
            'app.open' => Untyped::call(App::open(...))(...$arguments),
            'request.constructor' => new (Untyped::name(Request::class))(...$arguments),
            'request.targetPath' => Untyped::call(Request::targetPath(...))(...$arguments),
            'request.targetQuery' => Untyped::call(Request::targetQuery(...))(...$arguments),
            'response.constructor' => new (Untyped::name(Response::class))(...$arguments),
            'response.text' => Untyped::call(Response::text(...))(...$arguments),
            'result.redirect' => Untyped::call(Result::redirect(...))(...$arguments),
            'result.page' => Untyped::call(Result::page(...))(...$arguments),
            'result.invalid' => Untyped::call(Result::invalid(...))(...$arguments),
            'redirect.constructor' => new (Untyped::name(Redirect::class))(...$arguments),
            'not-found.constructor' => new (Untyped::name(NotFound::class))(...$arguments),
            'forbidden.constructor' => new (Untyped::name(Forbidden::class))(...$arguments),
            'bad-request.constructor' => new (Untyped::name(BadRequest::class))(...$arguments),
            'media-type.constructor' => new (Untyped::name(MediaType::class))(...$arguments),
            'uploaded-file.constructor' => new (Untyped::name(UploadedFile::class))(...$arguments),
            'array-session.constructor' => new (Untyped::name(ArraySession::class))(...$arguments),
            'native-session.constructor' => new (Untyped::name(NativeSession::class))(...$arguments),
            'redis-cluster-sessions.constructor' => new (Untyped::name(RedisClusterSessions::class))(...$arguments),
            'redis-sentinel-sessions.constructor' => new (Untyped::name(RedisSentinelSessions::class))(...$arguments),
            'client-rendering.constructor' => new (Untyped::name(ClientRendering::class))(...$arguments),
            'choice.constructor' => new (Untyped::name(Choice::class))(...$arguments),
            'representation.constructor' => new (Untyped::name(Representation::class))(...$arguments),
            default => throw new \UnexpectedValueException("the member {$member} of the case is unknown"),
        };
    }
}
