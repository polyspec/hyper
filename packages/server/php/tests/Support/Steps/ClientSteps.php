<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\Csrf;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Tests\CaseReader;
use Polyspec\Hyper\Tests\Support\ClientApp;
use Polyspec\Hyper\Tests\Support\Counter;
use Polyspec\Hyper\Tests\Support\CountingStore;
use Polyspec\Hyper\Tests\Support\Json;

/** HY-62: the cases of contracts/client.json. */
final class ClientSteps
{
    // A session token of HY-24; the form carries a masked value of it.
    private const TOKEN = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

    public static function cases(CaseReader $case): void
    {
        $basePath = Json::string($case->input('basePath'));
        $chosenHost = Json::string($case->input('chosenHost'));
        if ($case->input('shell') !== file_get_contents(ClientApp::SHELL)) {
            throw new \LogicException('the shell fixture differs from the shell file');
        }
        // The representations and the representation handler are not served by PHP yet (H28.7): they are read
        // here, and the handled and received fields are not compared, so their cases fail as FIELD_UNCOMPARED.
        $case->input('representations');
        $case->input('handler');

        $counter = new Counter();
        $store = new CountingStore();
        $request = Json::array($case->input('request'));
        $form = isset($request['form']) ? Json::stringMap($request['form']) : null;
        if ($request['csrf'] ?? false) {
            $store->preset('_hyper_csrf', self::TOKEN);
            $form = ['_csrf' => Csrf::masked(self::TOKEN), ...$form ?? []];
        }
        $headers = Json::stringMap($request['headers'] ?? null);
        if ($form !== null) {
            $headers['Content-Type'] = 'application/x-www-form-urlencoded';
        }
        $target = Json::string($request['target'] ?? null);
        $question = strpos($target, '?');
        $query = $question === false ? '' : substr($target, $question + 1);
        $path = $question === false ? $target : substr($target, 0, $question);
        $response = ClientApp::open($basePath, $chosenHost, $counter)->handle(
            new Request(
                Json::string($request['method'] ?? null),
                $path,
                $headers,
                $query,
                $form === null ? '' : http_build_query($form),
            ),
            $store,
        );

        $case->compare('storeCalls', $store->log);

        $case->compare('status', $response->status);
        $case->compare('headers', $response->headers);
        $case->compare('allHeaders', $response->headers);
        $case->compare('absentHeaders', $response->headers);
        $case->compare('body', $response->body);
        if ($case->has('json')) {
            // The maps of the response stay objects, so an empty map of the contract is an empty object.
            $json = json_decode($response->body) ?? new \stdClass();
            $case->compare('json.route', $json->route ?? null);
            $case->compare('json.params', $json->params ?? null);
            $case->compare('json.regions', $json->regions ?? null);
        }
        // HY-62: the session holds no token after a request whose expected session is false.
        $case->compare('session', $store->holds('_hyper_csrf'));
        $case->compare('actions', $counter->actions);
    }
}
