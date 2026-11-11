<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Polyspec\Hyper\Accept;

/**
 * HY-116: the Accept parser follows RFC 9110, section 12.5.1, and the selection of text/html and
 * application/vnd.hyper+json gives each type the weight of its most specific range. The expected values are the
 * cases of contracts/representations.json that need no representation, and the rules that they state.
 */
final class AcceptTest extends TestCase
{
    private const PAGE = 'text/html';
    private const DATA = 'application/vnd.hyper+json';

    /** @return list<string> */
    private static function types(): array
    {
        return [self::PAGE, self::DATA];
    }

    /** @return iterable<string, array{string|null, string|null}> */
    public static function selections(): iterable
    {
        // a_request_without_accept_selects_the_page
        yield 'a request without Accept selects the page' => [null, self::PAGE];
        // the_any_range_selects_the_page
        yield 'the any range selects the page' => ['*/*', self::PAGE];
        // the_text_range_selects_the_page
        yield 'the text range selects the page' => ['text/*', self::PAGE];
        // the_application_range_selects_the_page_data
        yield 'the application range selects the page data' => ['application/*', self::DATA];
        // the_most_specific_range_gives_the_weight
        yield 'the most specific range gives the weight' => [
            'text/html;q=0.2, text/*;q=0.9, application/vnd.hyper+json;q=0.5',
            self::DATA,
        ];
        // the_highest_weight_among_page_type_ranges_gives_the_weight
        yield 'the highest weight among the page type ranges gives the weight' => [
            'text/html;level=1;q=0, text/html;q=0.8',
            self::PAGE,
        ];
        // q_zero_on_a_specific_range_with_the_any_range
        yield 'q zero on a specific range with the any range' => ['text/html;q=0, */*', self::DATA];
        // q_zero_on_the_page_data_with_a_wildcard_leaves_no_type (the page types only)
        yield 'q zero on the page data with a wildcard leaves no type' => [
            'application/vnd.hyper+json;q=0, application/*;q=0.5',
            null,
        ];
        // An empty Accept is an empty list, which matches no type (HY-116).
        yield 'an empty Accept matches no type' => ['', null];
        // Ties go in the order text/html, then application/vnd.hyper+json (HY-116).
        yield 'a tie gives the first type in the order' => [
            'application/vnd.hyper+json;q=0.5, text/html;q=0.5',
            self::PAGE,
        ];
        yield 'a tie of the wildcard ranges gives the page' => ['*/*;q=0.5', self::PAGE];
        // Types, subtypes, parameter names and q compare without regard to case (HY-116).
        yield 'the names compare without regard to case' => [
            'TEXT/HTML;Level=1;Q=0.3, Application/Vnd.Hyper+JSON;q=0.2',
            self::PAGE,
        ];
        // A parameter after q is an accept extension, which does not change the weight of the range.
        yield 'a parameter after q is an accept extension' => [
            'text/html;q=0.5;x=y, application/vnd.hyper+json;q=0.4',
            self::PAGE,
        ];
        // A quoted string that holds a comma is one parameter value (RFC 9110, section 5.6.4).
        yield 'a quoted comma stays in its parameter' => [
            'text/html;x="a,b";q=0.5, application/vnd.hyper+json;q=0.4',
            self::PAGE,
        ];
        // An empty list element is ignored (RFC 9110, section 5.6.1).
        yield 'an empty list element is ignored' => [' , application/vnd.hyper+json ,, ', self::DATA];
        // q=1.000 is a qvalue, the same as q=1 (RFC 9110, section 12.4.2).
        yield 'q with three zero decimals is a qvalue' => [
            'text/html;q=0.000, application/vnd.hyper+json;q=1.000',
            self::DATA,
        ];
    }

    #[DataProvider('selections')]
    public function testSelectsTheMediaType(?string $accept, ?string $expected): void
    {
        self::assertSame($expected, Accept::select($accept, self::types()));
    }

    /** @return iterable<string, array{string}> */
    public static function invalidAccepts(): iterable
    {
        // an_invalid_accept_weight_is_a_bad_request
        yield 'q=x is not a qvalue' => ['text/html;q=x'];
        // an_accept_weight_above_one_is_a_bad_request
        yield 'q=1.5 is above one' => ['text/html;q=1.5'];
        yield 'q=1.001 is above one' => ['text/html;q=1.001'];
        yield 'q with four decimals is not a qvalue' => ['text/html;q=0.1234'];
        yield 'a space around the equal sign of q' => ['text/html;q = 0.5'];
        yield 'a text after a qvalue' => ['text/html;q=0.5x'];
        yield 'a range without a subtype' => ['text'];
        yield 'a wildcard type with a subtype' => ['*/html'];
        yield 'a trailing semicolon' => ['text/html;'];
        yield 'a parameter without a value' => ['text/html;level'];
        yield 'an unterminated quoted string' => ['text/html;x="a'];
        yield 'a space between the type and the slash' => ['text /html'];
        yield 'a missing comma between ranges' => ['text/html application/json'];
    }

    #[DataProvider('invalidAccepts')]
    public function testRejectsAnAcceptThatIsNotGrammatical(string $accept): void
    {
        $this->expectException(\InvalidArgumentException::class);

        Accept::select($accept, self::types());
    }

    public function testParsesTheRangesWithTheirParametersBeforeQ(): void
    {
        self::assertSame(
            [
                [
                    'type' => 'text',
                    'subtype' => 'html',
                    'parameters' => [['name' => 'level', 'value' => '1']],
                    'weight' => 500,
                ],
                [
                    'type' => '*',
                    'subtype' => '*',
                    'parameters' => [],
                    'weight' => 1000,
                ],
            ],
            Accept::parse('Text/HTML; Level=1; Q=0.5; x=y, */*'),
        );
    }

    public function testAMissingHeaderParsesAsAnyRange(): void
    {
        self::assertSame(
            [['type' => '*', 'subtype' => '*', 'parameters' => [], 'weight' => 1000]],
            Accept::parse(null),
        );
    }

    public function testAnEmptyHeaderParsesAsAnEmptyList(): void
    {
        self::assertSame([], Accept::parse(''));
    }
}
