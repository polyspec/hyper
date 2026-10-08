<!-- doc-id: composition -->
# Screen composition

[한국어](composition.ko.md).

This document defines which mechanism a screen part uses. A part is chosen by what differs between its uses. The template language and the region protocol already provide every mechanism below; a new mechanism is added only when a part fits none of them.

## Mechanisms

| What differs | Mechanism | Examples |
|---|---|---|
| Nothing but appearance | HTML element and CSS class | card, panel, button, table frame |
| Appearance and data | Block `{# path name:value}` with an isolated scope | post row, pager, field error |
| Appearance, data and independent update | Region: manifest entry, loader and topics | left menu, notification badge, widget |
| Appearance and data that change in the browser | Route region with region data changed by `hy-set` | sorted list, notice that closes |

- **HC-1** A part whose uses differ only in content is written as HTML with a CSS class at each use. Shared appearance lives in the stylesheet. There is no template abstraction for a wrapper.
- **HC-2** A part that receives data is a template file rendered with a block tag `{# path name:value}`. It reads only the root data and the arguments of the tag (template runtime rule RT-26). It does not read local variables of the caller.
- **HC-3** A part that loads its own data and changes independently of the page is a region (HY-1 to HY-3). It declares the topics it uses, and the server renders it again when one of those topics changes (HY-18, HY-19).
- **HC-4** The layout is the only template that places manifest regions, the title and the data. A route template fills the page region and places only the route regions of its route.
- **HC-5** Interactive behavior that HTML provides uses the HTML element: `<dialog>` for a modal, `<details>` for a disclosure, `<form>` for input. Navigation and form submission use plain `<a href>` and `<form method action>`.
- **HC-6** Only the layout carries `hx-*` attributes. Page, block and region templates contain none; htmx applies to them through the inherited attributes of the layout (HY-3, HY-21). `make templates-check` fails when a template other than the layout contains an `hx-` attribute.
- **HC-7** A part of a page that changes in the browser without a request is a route region (HY-30). Its screen state, such as a sort order or an open panel, is region data, and an element changes it with `hy-set` (HY-36) or code changes it with `set` (HY-33). Neither keeps state outside the region data. A value that must survive a reload is a kept path (HY-37): `server` or `cookie` when the first SSR document must show it, `localStorage` or `sessionStorage` when it stays in the browser.

## Example

```
<section class="card">
<h2>최근 글</h2>
<ul>{@ p = posts}<li>{# /board/row.tpl p}</li>{/}</ul>
</section>
```

The card is HTML with the class `card` (HC-1). Each row is a block that receives `p` (HC-2). If the list had to update without a page change, it would become a region with a loader and the topic `posts` (HC-3).
