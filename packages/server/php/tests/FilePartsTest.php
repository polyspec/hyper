<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\Request;
use Polyspec\Hyper\Tests\Support\Json;

/**
 * File parts of a multipart request (HY-113): the files of each contract case that states them, and the refusal of a
 * file name that is not UTF-8 (HY-42). The limit of HY-114 is tested with the application in AppTest.
 */
final class FilePartsTest extends TestCase
{
    public function testFilePartsOfTheContractCasesAreTheFilesOfTheRequest(): void
    {
        $cases = 0;
        $contracts = Json::arrays(Json::at(Json::file(__DIR__ . '/../../../../contracts/fields.json'), 'multipart'));
        foreach ($contracts as $case) {
            if (!isset($case['files'])) {
                continue;
            }
            ++$cases;
            $request = new Request(
                'POST',
                '/',
                ['Content-Type' => Json::string(Json::at($case, 'type'))],
                '',
                Json::string(Json::at($case, 'body')),
            );
            $got = [];
            foreach ($request->files() as $name => $files) {
                foreach ($files as $file) {
                    self::assertSame($name, $file->name());
                    $got[] = [
                        'name' => $file->name(),
                        'filename' => $file->filename(),
                        'contentType' => $file->contentType(),
                        'content' => $file->content(),
                    ];
                }
            }
            self::assertSame($case['files'], $got, Json::string(Json::at($case, 'id')));
        }
        self::assertGreaterThan(0, $cases);
    }

    public function testFilePartsWhoseNameIsNotUtf8AreRefused(): void
    {
        $body = "--x\r\nContent-Disposition: form-data; name=\"f\"; filename=\"\xFF.txt\"\r\n\r\nQ\r\n--x--\r\n";
        $request = new Request('POST', '/', ['Content-Type' => 'multipart/form-data; boundary=x'], '', $body);
        self::assertFalse($request->validInput());
    }
}
