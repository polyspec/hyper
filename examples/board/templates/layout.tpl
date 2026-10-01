<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{# title}</title>
<link rel="stylesheet" href="{= assets.css}">
<script type="module" src="{= assets.hyper}"></script>
</head>
<body hx-boost:inherited="true" hx-target:inherited="#content" hx-swap:inherited="innerMorph">
<div class="shell">
<aside id="left" hy-region>{# left}</aside>
<main id="content" hy-region>{# content}</main>
</div>
{# data}
</body>
</html>
