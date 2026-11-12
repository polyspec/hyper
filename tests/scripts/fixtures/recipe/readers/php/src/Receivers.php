<?php

declare(strict_types=1);

namespace Fixture\Readers;

/** The receivers of the scope reading (HYR-5): what the source writes about the class of each. */
final class Receivers
{
    private ?Widget $kept = null;

    public function match(): void
    {
        self::xor();
    }

    private static function xor(): void
    {
    }

    /**
     * Grows the widgets of two lists.
     *
     * @param list<Widget> $widgets
     * @param array<string, Widget> $others
     */
    public function listed(array $widgets, array $others): void
    {
        foreach ([...$widgets, ...$others] as $widget) {
            $widget->grow();
        }
    }

    public function made(): ?Widget
    {
        return null;
    }

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
        $opened = Widget::make("{$either->size}/x");
        $matched = match (true) {
            $opened === null => new Widget(),
            default => Widget::make('x'),
        };
    }
}
