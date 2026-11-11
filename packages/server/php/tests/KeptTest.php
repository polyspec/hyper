<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\Kept;

/**
 * HY-38: a kept value walks into the stdClass maps of the data. The cases of contracts/keep.json are run by the
 * case runner.
 */
final class KeptTest extends TestCase
{
    public function testWalksIntoStdClassMaps(): void
    {
        $data = Kept::apply(['notice' => (object) ['closed' => false]], [['notice.closed', true]]);

        self::assertSame('{"notice":{"closed":true}}', json_encode($data));
    }
}
