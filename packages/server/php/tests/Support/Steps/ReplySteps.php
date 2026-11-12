<?php

declare(strict_types=1);

namespace Polyspec\Hyper\Tests\Support\Steps;

use Polyspec\Hyper\Reply;
use Polyspec\Hyper\Tests\CaseReader;

/** HY-52, HY-60, HY-69, HY-72, HY-92, HY-103: the cases of contracts/reply.json, the reply of a request. */
final class ReplySteps
{
    /** Records the Set-Cookie values of the reply (HY-52). */
    public static function cookies(CaseReader $case): void
    {
        $secure = $case->has('secure') && $case->input('secure') === true;
        $case->compare('headers', self::applied($case, true)->cookieHeaders($secure));
    }

    /** Records the Cache-Control of the reply (HY-52). */
    public static function cacheControl(CaseReader $case): void
    {
        $case->compare('value', self::applied($case, true)->cacheControlValue());
    }

    /** Records the Referrer-Policy of the reply and its headers (HY-103). */
    public static function referrerPolicy(CaseReader $case): void
    {
        $reply = self::applied($case, true);
        $case->compare('value', $reply->referrerPolicyValue());
        // An empty PHP array is also a list; the object states that the headers are a map.
        $case->compare('headers', (object) $reply->referrerPolicyHeaders());
    }

    /** Records the page status of the reply (HY-69). */
    public static function status(CaseReader $case): void
    {
        $case->compare('value', self::applied($case, true)->statusValue());
    }

    /** Records the notes of the reply (HY-60). */
    public static function notes(CaseReader $case): void
    {
        $case->compare('notes', self::applied($case, true)->notes());
    }

    /** Records the renewal, taken twice, and the embedding of the reply (HY-72, HY-92). */
    public static function flags(CaseReader $case): void
    {
        $reply = self::applied($case, false);
        $case->compare('renewals', [$reply->takeRenewal(), $reply->takeRenewal()]);
        $case->compare('embeds', $reply->embedsData());
    }

    /**
     * Makes a reply and applies the calls of the case in order until one fails, and compares the message and the
     * class of the failure: `type` for a TypeError and `value` for the InvalidArgumentException of HY-46.2.
     */
    private static function applied(CaseReader $case, bool $compareFailure): Reply
    {
        $calls = $case->input('calls');
        if (!is_array($calls) || !array_is_list($calls)) {
            throw new \UnexpectedValueException('the calls of the case are not a list');
        }
        $reply = new Reply();
        $error = null;
        $kind = null;
        try {
            foreach ($calls as $entry) {
                if (!is_array($entry) || count($entry) !== 2 || !is_string($entry[0]) || !is_array($entry[1])) {
                    throw new \UnexpectedValueException('a call of the case is not a method and a list of JSON texts');
                }
                $arguments = [];
                foreach ($entry[1] as $text) {
                    if (!is_string($text)) {
                        throw new \UnexpectedValueException('an argument of the case is not a JSON text');
                    }
                    // The JSON text gives the value as a handler gives it (HY-44).
                    $arguments[] = json_decode($text, true, 512, JSON_THROW_ON_ERROR);
                }
                self::call($reply, $entry[0], $arguments);
            }
        } catch (\TypeError $failure) {
            $kind = 'type';
            $error = $failure->getMessage();
        } catch (\InvalidArgumentException $failure) {
            $kind = 'value';
            $error = $failure->getMessage();
        }
        if ($compareFailure) {
            $case->compare('error', $error);
            $case->compare('class', $kind);
        } elseif ($error !== null) {
            throw new \UnexpectedValueException("a call of the case fails: {$error}");
        }

        return $reply;
    }

    /**
     * Calls a method of the reply with the arguments as a caller may give them, of any type (HY-52.11).
     *
     * @param list<mixed> $arguments
     */
    public static function call(Reply $reply, string $method, array $arguments): void
    {
        match ($method) {
            'cookie' => $reply->cookie(...$arguments),
            'removeCookie' => $reply->removeCookie(...$arguments),
            'cacheControl' => $reply->cacheControl(...$arguments),
            'referrerPolicy' => $reply->referrerPolicy(...$arguments),
            'status' => $reply->status(...$arguments),
            'note' => $reply->note(...$arguments),
            'renewSession' => $reply->renewSession(),
            'embedData' => $reply->embedData(),
            default => throw new \UnexpectedValueException("the method {$method} of the case is unknown"),
        };
    }
}
