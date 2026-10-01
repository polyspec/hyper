<?php

declare(strict_types=1);

// Measures the CPU time of the PHP server without network, with the template program that PHP selects (HY-48): App::handle per request kind, and the
// template, data model and JSON costs as the number of rows grows. It uses its own database file,
// which it recreates on every run.
//
// Usage: php scripts/bench-server.php --app examples/board --iterations 300

use Polyspec\Hyper\App;
use Polyspec\Hyper\ArraySession;
use Polyspec\Hyper\Examples\Board\Assets;
use Polyspec\Hyper\Examples\Board\Posts;
use Polyspec\Hyper\JsonEncoder;
use Polyspec\Hyper\Renderer;
use Polyspec\Hyper\Request;
use Polyspec\Template\Value\Bind;

$options = getopt('', ['app:', 'iterations:']);
if (!isset($options['app'], $options['iterations'])) {
    fwrite(STDERR, "--app and --iterations are required\n");
    exit(2);
}
$app = rtrim((string) $options['app'], '/');
$iterations = (int) $options['iterations'];
require "{$app}/vendor/autoload.php";

$database = "{$app}/var/bench-server.db";
@unlink($database);
$posts = new Posts($database);
for ($index = 1; $index <= 30; $index++) {
    $posts->create("게시글 {$index} <제목> & \"따옴표\"", "작성자 {$index}", str_repeat("본문 {$index}\n", 5));
}

$application = App::open(
    manifest: "{$app}/app/app.json",
    program: "{$app}/build/server",
    handlers: require "{$app}/app/handlers.php",
    timezone: '+09:00',
);
$application->bind(Posts::class, fn (): Posts => $posts);
$application->bind(Assets::class, fn (): Assets => Assets::fromManifest("{$app}/public/assets/manifest.json"));
$session = new ArraySession();
$application->handle(new Request('GET', '/board'), $session);
$token = (string) $session->get('_hyper_csrf');
$json = ['Accept' => 'application/json'];
$region = ['Accept' => 'application/json', 'Hy-Region' => 'content', 'HX-Current-URL' => 'http://localhost/'];

/**
 * Runs a function repeatedly after a warm-up and returns the times in milliseconds.
 *
 * @return array{mean: float, p50: float, p95: float, bytes: int}
 */
function measure(int $iterations, Closure $run): array
{
    $bytes = 0;
    // $run returns the size of its output.
    for ($index = 0; $index < 20; $index++) {
        $run();
    }
    $times = [];
    for ($index = 0; $index < $iterations; $index++) {
        $start = hrtime(true);
        $bytes = $run();
        $times[] = (hrtime(true) - $start) / 1e6;
    }
    sort($times);

    return [
        'mean' => array_sum($times) / count($times),
        'p50' => $times[intdiv(count($times), 2)],
        'p95' => $times[(int) floor(count($times) * 0.95)],
        'bytes' => $bytes,
    ];
}

$requests = [
    'GET /board, document HTML' => fn (): Request => new Request('GET', '/board'),
    'GET /board, document JSON' => fn (): Request => new Request('GET', '/board', $json),
    'GET /board, region JSON with left' => fn (): Request => new Request('GET', '/board', $region),
    'GET /board/1, document HTML' => fn (): Request => new Request('GET', '/board/1'),
    'GET /board/1, region JSON' => fn (): Request => new Request('GET', '/board/1', $region),
    'POST /board/create, 422 region JSON' => fn (): Request => new Request('POST', '/board/create', $region, [], ['_csrf' => $token, 'title' => '', 'author' => 'a', 'body' => 'b']),
];
echo "## Requests (App::handle, 10 rows per page)\n\n| Request | status | mean ms | p50 ms | p95 ms | bytes |\n|---|---:|---:|---:|---:|---:|\n";
foreach ($requests as $label => $request) {
    $status = $application->handle($request(), $session)->status;
    $result = measure($iterations, function () use ($application, $request, $session): int {
        $response = $application->handle($request(), $session);

        return strlen($response->body);
    });
    printf("| %s | %d | %.3f | %.3f | %.3f | %d |\n", $label, $status, $result['mean'], $result['p50'], $result['p95'], $result['bytes']);
}

$renderer = Renderer::open("{$app}/build/server", '+09:00');
$shared = ['title' => '게시판', 'csrf' => $token];
echo "\n## Scaling with rows (board/rows.tpl)\n\n| Rows | render ms | Bind::value ms | json_encode ms | HTML bytes | JSON bytes |\n|---:|---:|---:|---:|---:|---:|\n";
foreach ([10, 100, 1000] as $count) {
    $rows = [];
    for ($index = 1; $index <= $count; $index++) {
        $rows[] = ['id' => $index, 'title' => "게시글 {$index} <제목>", 'author' => "작성자 {$index}", 'created_at' => 1790000000 + $index];
    }
    $data = ['posts' => $rows, 'sort' => 'title', 'compact' => false, 'highlight' => null];
    $value = JsonEncoder::value('+09:00', 'board.list', [], $shared, ['rows' => $data]);
    $render = measure(max(20, intdiv($iterations, 10)), fn (): int => strlen($renderer->alone('board/rows.tpl', $shared, $data)));
    $bind = measure(max(20, intdiv($iterations, 10)), function () use ($value): int {
        Bind::value($value);

        return 0;
    });
    $encode = measure(max(20, intdiv($iterations, 10)), fn (): int => strlen(JsonEncoder::encode($value)));
    printf("| %d | %.3f | %.3f | %.3f | %d | %d |\n", $count, $render['mean'], $bind['mean'], $encode['mean'], $render['bytes'], $encode['bytes']);
}
printf("\nPHP %s, %s template program, %d iterations per request, %s\n", PHP_VERSION, $renderer->engine, $iterations, php_uname('s') . ' ' . php_uname('m'));
@unlink($database);
