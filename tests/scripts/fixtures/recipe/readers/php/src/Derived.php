<?php

class Derived extends Widget {
    public static function make(): self {
        return new self();
    }
}
