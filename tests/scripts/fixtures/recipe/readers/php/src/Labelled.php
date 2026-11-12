<?php

namespace Fixture\Readers;

trait Labelled
{
    public string $label = '';

    public function describe(): string
    {
        return $this->label;
    }
}
