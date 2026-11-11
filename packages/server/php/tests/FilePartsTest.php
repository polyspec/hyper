<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\Request;

/**
 * File parts of a multipart request (HY-113): the refusal of a file name that is not UTF-8 (HY-42). The files of the
 * contract cases are run by the case runner; the limit of HY-114 is tested with the application in AppTest.
 */
final class FilePartsTest extends TestCase
{
    public function testFilePartsWhoseNameIsNotUtf8AreRefused(): void
    {
        $body = "--x\r\nContent-Disposition: form-data; name=\"f\"; filename=\"\xFF.txt\"\r\n\r\nQ\r\n--x--\r\n";
        $request = new Request('POST', '/', ['Content-Type' => 'multipart/form-data; boundary=x'], '', $body);
        self::assertFalse($request->validInput());
    }
}
