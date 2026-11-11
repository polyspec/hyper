<?php

trait Labelled {
    public string $label = '';

    public function describe(): string {
        return $this->label;
    }
}
