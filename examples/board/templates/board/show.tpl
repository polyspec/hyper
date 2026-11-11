<article class="post">
<header class="board-head">
<h1>{= post.title}</h1>
<a href="/board" class="button secondary">목록</a>
</header>
<p class="post-meta">{= post.author} · {= date(post.created_at, 'Y-m-d H:i')}</p>
{? post.attachment}<p class="post-file">첨부: {= post.attachment.name} ({= post.attachment.size} bytes)</p>
{/}<div id="reader">{# reader}</div>
</article>
