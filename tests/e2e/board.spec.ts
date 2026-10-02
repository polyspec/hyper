import { expect, test, type BrowserContext, type Page, type Response } from '@playwright/test';
import { ports } from '../../playwright.config.js';

// The tests share one database and run in order: each test starts from the posts created before it.
test.describe.configure({ mode: 'serial' });

const ssr = `http://127.0.0.1:${ports.ssr}`;
const csr = `http://127.0.0.1:${ports.edge}`;

// Waits for the htmx fetch response of a path; a followed redirect reports its final URL.
function fetchResponse(page: Page, path: string): Promise<Response> {
  return page.waitForResponse((response) => new URL(response.url()).pathname === path && response.request().resourceType() === 'fetch');
}

// Collects console errors; Chromium logs every 4xx response, and the expected 422 response is allowed.
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('status of 422')) errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function markDocument(page: Page): Promise<void> {
  await page.evaluate(() => { (window as unknown as { documentMarker: number }).documentMarker = 1; });
}

async function documentWasKept(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as { documentMarker?: number }).documentMarker === 1);
}

// Runs the board flow: list, create page, rejected input, accepted input, detail page, history back.
async function boardFlow(page: Page, origin: string, dataPrefix: string, title: string, expectedCount: number): Promise<void> {
  const errors = collectErrors(page);
  await page.goto(`${origin}/board`);
  await expect(page.locator('#content h1')).toHaveText('게시판');
  await expect(page.locator('#left .badge')).toHaveText(String(expectedCount - 1));
  await markDocument(page);

  // HY-20, HY-21: the link requests JSON for the content region and the browser renders it.
  const createPage = fetchResponse(page, `${dataPrefix}/board/create`);
  await page.getByRole('link', { name: '글쓰기' }).click();
  expect((await createPage).headers()['content-type']).toContain('application/json');
  await expect(page).toHaveURL(`${origin}/board/create`);
  await expect(page).toHaveTitle('글쓰기 · 게시판 예제');

  // HY-26: invalid input returns 422 and the form shows the error with the entered values.
  await page.locator('input[name="author"]').fill('김작가');
  await page.locator('textarea[name="body"]').fill('첫 줄\n둘째 줄');
  const rejected = fetchResponse(page, `${dataPrefix}/board/create`);
  await page.getByRole('button', { name: '등록' }).click();
  expect((await rejected).status()).toBe(422);
  await expect(page.locator('#content .error')).toHaveText('제목을 입력하세요.');
  await expect(page.locator('input[name="author"]')).toHaveValue('김작가');

  // HY-25: a successful action redirects; the list shows the new post and the left badge changes.
  await page.locator('input[name="title"]').fill(title);
  const list = fetchResponse(page, `${dataPrefix}/board`);
  await page.getByRole('button', { name: '등록' }).click();
  expect((await list).headers()['content-type']).toContain('application/json');
  await expect(page).toHaveURL(`${origin}/board`);
  await expect(page.locator('.board-table tr.new td').nth(1)).toHaveText(title);
  await expect(page.locator('#left .badge')).toHaveText(String(expectedCount));
  await expect(page).toHaveTitle('게시판 · 게시판 예제');

  // HY-5, HY-6: a parameter route renders the detail page.
  await page.getByRole('link', { name: title }).click();
  await expect(page).toHaveURL(new RegExp(`${origin}/board/\\d+$`));
  await expect(page.locator('#content h1')).toHaveText(title);
  await expect(page.locator('.post-body')).toContainText('둘째 줄');
  expect(await documentWasKept(page)).toBe(true);

  // HY-23: history restoration renders the restored path.
  await page.goBack();
  await expect(page).toHaveURL(`${origin}/board`);
  await expect(page.locator('#content h1')).toHaveText('게시판');
  expect(errors).toEqual([]);
}

test('SSR: PHP renders the first document and the browser renders region JSON', async ({ page }) => {
  await boardFlow(page, ssr, '', 'SSR 글', 1);
});

test('CSR: a static shell renders every document from /api JSON', async ({ page }) => {
  const shell = await page.request.get(`${csr}/board`);
  expect(await shell.text()).toContain('<html>\n');
  expect(await shell.text()).toContain('<body></body>');
  // HY-63: the html element takes the attributes of the rendered layout, as the server-rendered document has them.
  await page.goto(`${ssr}/board`);
  const rendered = await page.evaluate(() => document.documentElement.outerHTML.slice(0, document.documentElement.outerHTML.indexOf('>') + 1));
  await page.goto(`${csr}/board`);
  await expect(page.locator('#content h1')).toHaveText('게시판');
  expect(await page.evaluate(() => document.documentElement.outerHTML.slice(0, document.documentElement.outerHTML.indexOf('>') + 1))).toBe(rendered);
  expect(rendered).toBe('<html lang="ko">');
  await boardFlow(page, csr, '/api', 'CSR 글', 2);
});

// HY-33, HY-36: hy-set changes region data and renders the region with no data request. Template files
// are static assets; the page starts loading them when it holds the data (HY-32, HY-35). Saving a
// server kept value is a background request that rendering does not wait for (HY-39).
async function dataFlow(page: Page, origin: string): Promise<void> {
  const errors = collectErrors(page);
  await page.goto(`${origin}/board`);
  await expect(page.locator('#rows tbody tr')).toHaveCount(2);
  await page.waitForLoadState('networkidle');
  const requests: string[] = [];
  page.on('request', (request) => {
    if (!new URL(request.url()).pathname.endsWith('/_hyper/keep')) requests.push(request.url());
  });

  await page.getByRole('button', { name: '제목순' }).click();
  await expect(page.locator('#rows .chip.current')).toHaveText('제목순');
  const titles = await page.locator('#rows tbody tr td:nth-child(2)').allTextContents();
  expect(titles).toEqual([...titles].sort());
  await page.getByRole('button', { name: '최신순' }).click();
  await expect(page.locator('#rows .chip.current')).toHaveText('최신순');

  await page.getByRole('button', { name: '닫기' }).click();
  await expect(page.getByRole('button', { name: '공지 펼치기' })).toBeVisible();
  await page.getByRole('button', { name: '공지 펼치기' }).click();
  await expect(page.locator('#notice .notice p')).toContainText('서버 요청 없이');

  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
}

test('SSR: the first page changes region data without a request', async ({ page }) => {
  await dataFlow(page, ssr);
});

test('CSR: region data changes without a request', async ({ page }) => {
  await dataFlow(page, csr);
});

// HY-37 to HY-40: each kind keeps its value across a reload; sessionStorage stays in its tab.
async function keepFlow(page: Page, context: BrowserContext, origin: string, dataPrefix: string): Promise<void> {
  const errors = collectErrors(page);
  await page.goto(`${origin}/board`);
  await page.waitForLoadState('networkidle');

  const saved = page.waitForResponse((response) => new URL(response.url()).pathname === `${dataPrefix}/_hyper/keep`);
  await page.getByRole('button', { name: '닫기' }).click();
  await expect(page.getByRole('button', { name: '공지 펼치기' })).toBeVisible();
  expect((await saved).status()).toBe(204);
  await page.getByRole('button', { name: '제목순' }).click();
  await page.getByRole('button', { name: '좁게 보기' }).click();
  await expect(page.locator('.board-table.compact')).toBeVisible();

  await page.locator('#rows tbody a').first().click();
  await expect(page).toHaveURL(new RegExp(`${origin}/board/\\d+$`));
  await page.getByRole('button', { name: '큰 글자' }).click();
  await expect(page.locator('.post-body.large')).toBeVisible();
  const detail = page.url();

  await page.reload();
  await expect(page.locator('.post-body.large')).toBeVisible();
  await page.goto(`${origin}/board`);
  await expect(page.getByRole('button', { name: '공지 펼치기' })).toBeVisible();
  await expect(page.locator('#rows .chip.current').first()).toHaveText('제목순');
  await expect(page.locator('.board-table.compact')).toBeVisible();

  // The server reads server and cookie values; localStorage and sessionStorage stay in the browser.
  if (dataPrefix === '') {
    const list = await (await page.request.get(`${origin}/board`)).text();
    expect(list).toContain('공지 펼치기');
    expect(list).not.toContain('board-table compact');
    expect(await (await page.request.get(detail)).text()).toContain('post-body large');
  } else {
    const json = await (await page.request.get(`${origin}${dataPrefix}/board`, { headers: { Accept: 'application/json' } })).json();
    // HY-17: regions hold the loader data, and kept holds the server and cookie values.
    expect(json.regions.notice.notice.closed).toBe(false);
    expect(json.kept.notice['notice.closed']).toBe(true);
    expect(json.regions.rows.sort).toBe('');
    expect(json.kept.rows).toBeUndefined();
  }

  const tab = await context.newPage();
  await tab.goto(`${origin}/board`);
  await expect(tab.getByRole('button', { name: '공지 펼치기' })).toBeVisible();
  await expect(tab.locator('#rows .chip.current').first()).toHaveText('제목순');
  await expect(tab.locator('.board-table.compact')).toHaveCount(0);
  await tab.close();
  expect(errors).toEqual([]);
}

test('SSR keeps values in the server session, a cookie, localStorage and sessionStorage', async ({ page, context }) => {
  await keepFlow(page, context, ssr, '');
});

test('CSR keeps values in the server session, a cookie, localStorage and sessionStorage', async ({ page, context }) => {
  await keepFlow(page, context, csr, '/api');
});

test('CSR loads only the templates that a route needs', async ({ page }) => {
  const templates: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/assets/templates/')) templates.push(path.replace(/^\/assets\/templates\/|\.[0-9a-f]+\.json$/g, ''));
  });
  await page.goto(`${csr}/board`);
  await expect(page.locator('#content h1')).toHaveText('게시판');
  expect(templates.sort()).toEqual(['board-list', 'board-notice', 'board-rows', 'hyper-data', 'layout', 'left', 'title']);

  templates.length = 0;
  await page.getByRole('link', { name: '글쓰기' }).click();
  await expect(page.locator('#content h1')).toHaveText('글쓰기');
  expect(templates).toEqual(['board-create']);
});

test('SSR: after a history restore the list holds its own data (HY-32)', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(`${ssr}/board`);
  await page.locator('#rows tbody a').first().click();
  await expect(page.locator('#reader')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#rows')).toBeVisible();
  await page.getByRole('button', { name: '제목순' }).click();
  await expect(page.locator('#rows .chip.current').first()).toHaveText('제목순');
  expect(errors).toEqual([]);
});

test('a failed region request keeps the page and marks the region (HY-47)', async ({ page }) => {
  for (const origin of [ssr, csr]) {
    await page.goto(`${origin}/board`);
    await page.waitForLoadState('networkidle');
    const failed = page.waitForResponse((response) => response.status() === 404);
    await page.evaluate(() => (window as unknown as { htmx: { ajax(method: string, path: string, options: object): Promise<unknown> } }).htmx.ajax('GET', '/board/999', { target: '#content' }));
    await failed;
    await expect(page.locator('#content')).toHaveAttribute('hy-error', '404');
    await expect(page.locator('#content h1')).toHaveText('게시판');
    await expect(page).toHaveURL(`${origin}/board`);
    await page.getByRole('link', { name: '글쓰기' }).click();
    await expect(page.locator('#content h1')).toHaveText('글쓰기');
    await expect(page.locator('#content')).not.toHaveAttribute('hy-error');
  }
});

test('the comparison page accepts only an http origin', async ({ page }) => {
  let dialogs = 0;
  page.on('dialog', (dialog) => { dialogs++; void dialog.dismiss(); });
  await page.goto(`${csr}/compare?ssr=${encodeURIComponent('javascript:alert(1)//')}`);
  await expect(page.locator('#ssr')).toHaveAttribute('src', `${csr}/board`);
  expect(dialogs).toBe(0);
});

test('SSR works without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${ssr}/board/create`);
  await page.locator('input[name="title"]').fill('JS 없는 글');
  await page.locator('input[name="author"]').fill('이작가');
  await page.locator('textarea[name="body"]').fill('본문');
  await page.getByRole('button', { name: '등록' }).click();
  await expect(page).toHaveURL(`${ssr}/board`);
  await expect(page.locator('.board-table tr.new td').nth(1)).toHaveText('JS 없는 글');
  await expect(page.locator('#left .badge')).toHaveText('3');
  await context.close();
});

test('the comparison page shows identical SSR and CSR bodies', async ({ page }) => {
  await page.goto(`${csr}/compare?ssr=${encodeURIComponent(ssr)}`);
  await expect(page.locator('#status')).toHaveText('body 일치');

  await page.locator('input[name="path"]').fill('/board/1');
  await page.getByRole('button', { name: '두 화면 열기' }).click();
  await expect(page.locator('#ssr-path')).toHaveText('/board/1');
  await expect(page.locator('#status')).toHaveText('body 일치');

  // Navigation inside each frame keeps both bodies identical.
  for (const frame of ['#ssr', '#csr']) {
    await page.frameLocator(frame).getByRole('link', { name: '목록' }).click();
  }
  await expect(page.locator('#ssr-path')).toHaveText('/board');
  await expect(page.locator('#csr-path')).toHaveText('/board');
  await expect(page.locator('#status')).toHaveText('body 일치');
});
