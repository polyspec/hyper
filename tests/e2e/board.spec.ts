import { expect, test, type Page, type Response } from '@playwright/test';
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
  expect(await shell.text()).toContain('<body></body>');
  await boardFlow(page, csr, '/api', 'CSR 글', 2);
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
