<?php

declare(strict_types=1);

namespace Polyspec\Hyper;

/**
 * Answers the page of a route as a document or as JSON (HY-10 to HY-19, HY-31, HY-38, HY-44, HY-53, HY-69, HY-73,
 * HY-75, HY-92, HY-124, HY-128) with the steps of a page of the core: `PageRequest::next` names each handler, the
 * server calls it and gives its result to the next step, and the last step holds the document or the JSON text. The
 * core selects the regions, checks every value (HY-44), keeps the read paths (HY-73), applies the kept values (HY-38)
 * and renders; the server holds no rule of them.
 *
 * @internal
 *
 * @phpstan-import-type RouteDefinition from Manifest
 * @phpstan-import-type RouteHandler from App
 */
final class Page
{
    /** The media type of a JSON response (HY-15, HY-116). */
    private const DATA_TYPE = 'application/vnd.hyper+json';

    /**
     * @internal
     *
     * @param Pages $pages the pages of the application that the core opened
     * @param ?\Closure $shared the shared handler, or null without one
     * @param array<string, \Closure> $regionLoaders the loaders of the regions that are no route regions
     * @param ?\Closure $context the context handler (HY-124), or null without one
     */
    public function __construct(
        private readonly Manifest $manifest,
        private readonly Pages $pages,
        private readonly ?\Closure $shared,
        private readonly array $regionLoaders,
        private readonly Container $container,
        private readonly bool $https,
        private readonly ?\Closure $context,
    ) {
    }

    /** Returns the Vary of a response with text/html or application/vnd.hyper+json, built per response (HY-117). */
    private function varyHeader(): string
    {
        return CoreRules::shared()->appVaryHeader($this->context !== null);
    }

    /**
     * Renders the route page as a document or as JSON. `$action` is the status and the data of the result of the action
     * of a POST request that answers its page (HY-26), or null for a GET request; the request holds the masked token of
     * the session after a renewal of the action (HY-72.3).
     *
     * @param RouteDefinition $route
     * @param RouteHandler $handler
     * @param array{int, array<array-key, mixed>}|ActionOutcomeRevisionChanged|null $action
     *
     * @internal
     */
    public function respond(
        Request $request,
        array $route,
        array $handler,
        Session $session,
        Flash $flash,
        array|ActionOutcomeRevisionChanged|null $action,
        Reply $reply,
        string $basePath,
    ): Response {
        $provided = [Request::class => $request, Reply::class => $reply];
        $json = $request->wantsJson();
        $page = new PageRequest(
            $this->pages,
            $route['name'],
            $request->params(),
            $json ? ($request->isRegionRequest() ? PageKind::RegionJson : PageKind::DocumentJson) : PageKind::Html,
            $action !== null,
            $request->csrfToken(),
            RegionPlanner::changedTopics($request, $flash, $basePath),
            // HY-14.3: one whole number of seconds for every render of the response.
            (float) time(),
            // On HTTPS only the host-only cookie counts, which another host cannot set (HY-38).
            self::utf8($request->cookie(CoreRules::shared()->keptCookieName($this->https || $request->https))),
            $request->header('Hyper-Context'),
        );
        // The regions whose loader gave data, in the order of their calls; the session is read for these (HY-38.20).
        $present = [];
        $pageRegion = $this->manifest->page->name;
        $step = $page->next(new PageStepInputStart());
        while ($step instanceof StepCall) {
            $call = $step->call;
            if ($call instanceof CallAction) {
                if ($action === null) {
                    throw new \LogicException('a page without an action asked for its action');
                }
                // HY-107.9: a revision change is the core outcome with no data; the core answers it as the 409 page.
                $outcome = $action instanceof ActionOutcomeRevisionChanged
                    ? $action
                    : new ActionOutcomePage($action[0], self::map($action[1], "the action of route {$route['name']}"));
                $input = new PageStepInputAction($outcome, null);
            } elseif ($call instanceof CallContext) {
                // HY-124: the context handler runs after the action and before the shared handler and any loader.
                if ($this->context === null) {
                    throw new \LogicException('a page without a context handler asked for its context');
                }
                $input = new PageStepInputContext(
                    self::map(Context::held($this->context, $request->selection()), 'the context handler'),
                );
            } elseif ($call instanceof CallShared) {
                $input = $this->shared === null
                    ? new PageStepInputNoHandler()
                    : new PageStepInputShared(
                        self::map($this->container->call($this->shared, $provided), 'the shared handler'),
                    );
            } elseif ($call instanceof CallRouteLoader) {
                $input = isset($handler['load'])
                    ? new PageStepInputLoaded(self::map(
                        $this->container->call($handler['load'], $provided),
                        "the loader of route {$route['name']}",
                    ))
                    : new PageStepInputNoHandler();
                $present[] = $pageRegion;
            } elseif ($call instanceof CallRouteRegionLoader) {
                /** @var string $region The type that the extension declares for the member (T-1a). */
                $region = $call->region;
                $loader = $handler['regions'][$region] ?? null;
                if ($loader === null) {
                    $input = new PageStepInputNoHandler();
                    $present[] = $region;
                } else {
                    $loaded = $this->container->call($loader, $provided);
                    // HY-75: a route region loader that returns null makes the region absent from this response.
                    if ($loaded === null) {
                        $input = new PageStepInputAbsent();
                    } else {
                        $input = new PageStepInputLoaded(self::map($loaded, "the loader of region {$region}"));
                        $present[] = $region;
                    }
                }
            } elseif ($call instanceof CallRegionLoader) {
                /** @var string $region The type that the extension declares for the member (T-1a). */
                $region = $call->region;
                $loader = $this->regionLoaders[$region] ?? null;
                $input = $loader === null
                    ? new PageStepInputNoHandler()
                    : new PageStepInputLoaded(self::map(
                        $this->container->call($loader, $provided),
                        "the loader of region {$region}",
                    ));
                $present[] = $region;
            } else {
                // HY-38.20: the stored kept values are read after every loader returned. HY-92, HY-69: the reply
                // states whether a document embeds its data and the status of a page with status 200.
                $stored = [];
                foreach ($present as $name) {
                    $stored[$name] = self::map($session->kept($name), "the kept values of region {$name}");
                }
                $input = new PageStepInputReply($reply->embedsData(), $stored, $reply->statusValue());
            }
            $step = $page->next($input);
        }
        $answer = $step instanceof StepAnswer ? $step->answer : null;
        if (!$answer instanceof AnswerJson && !$answer instanceof AnswerDocument) {
            throw new \LogicException('the page of a request answered no page');
        }
        /** @var int $status The type that the extension declares for the member (T-1a). */
        $status = $answer->status;
        /** @var string $body The type that the extension declares for the member (T-1a). */
        $body = $answer instanceof AnswerJson ? $answer->text : $answer->html;
        if ($answer instanceof AnswerJson) {
            return $this->json($request, $session, $reply, $status, $body);
        }

        return new Response($status, [
            'Content-Type' => 'text/html; charset=utf-8',
            'Cache-Control' => $status === 200 ? ($reply->cacheControlValue() ?? 'no-store') : 'no-store',
            'Vary' => $this->varyHeader(),
            ...$reply->referrerPolicyHeaders(),
        ], $body);
    }

    /** Answers the JSON text of a page with its headers, its tag and the 304 of a matching tag (HY-53). */
    private function json(Request $request, Session $session, Reply $reply, int $status, string $body): Response
    {
        $headers = [
            'Content-Type' => self::DATA_TYPE,
            'Cache-Control' => $status === 200 ? ($reply->cacheControlValue() ?? 'no-store') : 'no-store',
            'Vary' => $this->varyHeader(),
            ...$reply->referrerPolicyHeaders(),
        ];
        if ($status !== 200) {
            return new Response($status, $headers, $body);
        }
        // HY-53: a weak tag of the body with the masked token replaced by the session token, so the mask does not
        // change it; a matching GET request receives 304 without a body and without `Content-Type`, because a 304
        // carries no representation.
        $tag = CoreRules::shared()->pageTag($body, $request->csrfToken(), $session->csrfToken());
        $headers['ETag'] = $tag;
        if ($request->method !== 'GET' || $request->header('If-None-Match') !== $tag) {
            return new Response(200, $headers, $body);
        }
        unset($headers['Content-Type']);

        return new Response(304, $headers, '');
    }

    /**
     * Returns the result of a handler as the map that a step of the core takes: an array that is empty or is not a
     * list (HY-44); another value fails with HY-43. A `JsonSerializable` is replaced by its value, read once (HY-44.6),
     * and the binding converts the values, which the core checks (HY-44.12).
     *
     * @return array<array-key, mixed>
     */
    private static function map(mixed $value, string $source): array
    {
        if (!is_array($value) || ($value !== [] && array_is_list($value))) {
            throw new \LogicException("{$source} did not return a map");
        }
        /** @var array<array-key, mixed> $plain */
        $plain = DataModel::plain($value);

        return $plain;
    }

    /**
     * Returns the value of the hy-keep cookie, or null for a cookie that is absent (HY-42). A cookie whose bytes are
     * not UTF-8 is no JSON text, so the core reads it as the empty text, which gives no value.
     */
    private static function utf8(?string $text): ?string
    {
        return $text === null ? null : (preg_match('//u', $text) === 1 ? $text : '');
    }
}
