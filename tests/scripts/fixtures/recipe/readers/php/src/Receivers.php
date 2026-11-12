<?php

declare(strict_types=1);

namespace Fixture\Readers;

/** The receivers of the scope reading (HYR-5): what the source writes about the class of each. */
final class Receivers
{
    private ?Widget $kept = null;

    public function run(Widget $widget, array $items): void
    {
        $widget->grow();
        Widget::make();
        $this->other();
        $made = new Widget();
        $this->kept = $made;
        $items[0]->count();
        foreach ($this->all() as $item) {
            $item->size;
        }
        $either = $widget ?? new Widget();
        $either->grow();
    }
}
