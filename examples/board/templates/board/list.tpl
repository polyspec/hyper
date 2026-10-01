<section class="board">
<header class="board-head">
<h1>게시판</h1>
<a href="/board/create" class="button">글쓰기</a>
</header>
<table class="board-table">
<thead>
<tr><th>번호</th><th>제목</th><th>작성자</th><th>작성일</th></tr>
</thead>
<tbody>
{@ post = posts}
<tr{? post.id == highlight} class="new"{/}>
<td>{= post.id}</td>
<td><a href="/board/{= post.id}">{= post.title}</a></td>
<td>{= post.author}</td>
<td>{= date(post.created_at, 'Y-m-d H:i')}</td>
</tr>
{:}
<tr><td colspan="4" class="empty">게시글이 없습니다.</td></tr>
{/}
</tbody>
</table>
<nav class="pager">
{@ n = range(1, pages)}
<a href="/board?page={= n}"{? n == page} class="current"{/}>{= n}</a>
{/}
</nav>
</section>
