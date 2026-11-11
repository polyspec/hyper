<?php

class Helpers {
    public static int $calls = 0;

    public static function twice(int $n): int {
        return 2 * $n;
    }
}
