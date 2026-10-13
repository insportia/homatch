// Owned-UI browser QA using synthetic data and in-memory request interception.
// Never opens or submits a real portal. Built with the same production components.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright-core';
const root = resolve('publisher-worker/artifacts/ui');
const screenshots = resolve('publisher-worker/artifacts/screenshots');
const propertyId = '33333333-3333-4333-8333-333333333333';
function fixture(lang = 'en') {
  return {
    lang,
    properties: [
      {
        id: propertyId,
        user_id: 'fixture-owner',
        homatch_id: 123456,
        title: 'QA apartment · Tbilisi',
        facts: { city: 'Tbilisi' },
        photos: [],
      },
    ],
    snapshot: {
      portals: [
        {
          id: 'myhome',
          name: 'MyHome',
          domain: 'myhome.ge',
          enabled: true,
          maintenance: false,
          permission: 'verified',
          operations: { publish: true, update: true, remove: true },
          metadata: {},
          registration_url: null,
        },
        {
          id: 'ss',
          name: 'SS.ge',
          domain: 'ss.ge',
          enabled: true,
          maintenance: false,
          permission: 'verified',
          operations: { publish: true, update: true, remove: true },
          metadata: {},
          registration_url: null,
        },
        {
          id: 'livo',
          name: 'Livo',
          domain: 'livo.ge',
          enabled: false,
          maintenance: true,
          permission: 'pending',
          operations: {},
          metadata: {},
          registration_url: null,
        },
      ],
      accounts: [
        { id: 'fixture-account1', portal_id: 'myhome', status: 'connected' },
        { id: 'fixture-account2', portal_id: 'ss', status: 'connected' },
      ],
      publications: [],
      jobs: [],
      events: [],
      selections: [],
      versions: [],
    },
  };
}
async function open(
  browser,
  {
    lang = 'en',
    width = 1440,
    reduced = false,
    path = '/publishing',
    data = fixture(lang),
  } = {},
) {
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((value) => {
    window.fixture = value;
    window.requests = [];
  }, data);
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'homatch.test') return route.abort();
    const target = resolve(
      root,
      '.' +
        (url.pathname === '/' || !extname(url.pathname)
          ? '/index.html'
          : url.pathname),
    );
    if (!target.startsWith(root)) return route.abort();
    try {
      await route.fulfill({
        body: await readFile(target),
        contentType:
          {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.svg': 'image/svg+xml',
          }[extname(target)] ?? 'application/octet-stream',
      });
    } catch {
      await route.abort();
    }
  });
  await page.goto(`https://homatch.test${path}`);
  await page.waitForSelector('.pub-center,.pub-showcase');
  await page.waitForFunction(
    () =>
      document.querySelector('.pub-showcase') ||
      document.querySelector('.pub-property-row'),
  );
  return { page, context, errors };
}
test('individual selection, exact confirmation, persistence and real event rendering', async () => {
  await mkdir(screenshots, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const { page, context, errors } = await open(browser);
    await page.locator('.pub-portal-row input').nth(0).check();
    assert.equal(
      await page.locator('.pub-portal-row input').nth(2).isDisabled(),
      true,
    );
    await page
      .getByRole('button', { name: 'Publish selected', exact: true })
      .click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert.match(await dialog.locator('ul').innerText(), /MyHome/);
    assert.doesNotMatch(await dialog.locator('ul').innerText(), /SS.ge/);
    await page.screenshot({
      path: resolve(screenshots, 'confirmation-desktop.png'),
    });
    await dialog
      .getByRole('button', { name: 'Confirm operation', exact: true })
      .click();
    await page.getByText('Uploading images', { exact: true }).first().waitFor();
    await page.setViewportSize({ width: 390, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: resolve(screenshots, 'journey-uploading-mobile.png'),
      fullPage: true,
    });
    const enqueues = await page.evaluate(() =>
      window.requests.filter((r) => r.action === 'enqueue'),
    );
    assert.deepEqual(enqueues[0].portals, ['myhome']);
    assert.equal(enqueues.length, 1);
    await page.evaluate(() => {
      window.fixture.snapshot.jobs[0].state = 'action_required';
      window.fixture.snapshot.jobs[0].phase = 'action_required';
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.getByRole('button', { name: 'Retry / reconcile' }).waitFor();
    await page.screenshot({
      path: resolve(screenshots, 'journey-action-required-mobile.png'),
      fullPage: true,
    });
    await page.evaluate(() => {
      window.fixture.snapshot.jobs[0].state = 'succeeded';
      window.fixture.snapshot.jobs[0].phase = 'published';
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.getByText('Published', { exact: true }).first().waitFor();
    await page.screenshot({
      path: resolve(screenshots, 'journey-published-mobile.png'),
      fullPage: true,
    });
    await page.reload();
    await page.waitForSelector('.pub-property-row');
    // Fixture data is reset on reload; persisted server selection is tested by a fresh route snapshot below.
    assert.deepEqual(errors, []);
    await context.close();
    const persisted = fixture();
    persisted.snapshot.selections = [
      { property_id: propertyId, portal_ids: ['ss'] },
    ];
    const restored = await open(browser, { data: persisted });
    assert.equal(
      await restored.page.locator('.pub-portal-row input').nth(1).isChecked(),
      true,
    );
    assert.equal(
      await restored.page.locator('.pub-portal-row input').nth(0).isChecked(),
      false,
    );
    await restored.context.close();
  } finally {
    await browser.close();
  }
});
test('desktop, tablet, mobile, RTL and reduced-motion visual matrix', async () => {
  await mkdir(screenshots, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const item of [
      { lang: 'en', width: 1440 },
      { lang: 'ka', width: 768 },
      { lang: 'en', width: 390 },
      { lang: 'ar', width: 390 },
      { lang: 'he', width: 390 },
      { lang: 'en', width: 390, reduced: true },
    ]) {
      const { page, context, errors } = await open(browser, item);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        JSON.stringify(item),
      );
      assert.equal(
        await page.locator('.pub-center').getAttribute('dir'),
        ['ar', 'he'].includes(item.lang) ? 'rtl' : 'ltr',
      );
      await page.screenshot({
        path: resolve(
          screenshots,
          `center-${item.lang}-${item.width}${item.reduced ? '-reduced' : ''}.png`,
        ),
        fullPage: true,
      });
      await page.keyboard.press('Tab');
      assert.ok(
        await page.evaluate(() => document.activeElement !== document.body),
      );
      assert.deepEqual(errors, []);
      await context.close();
    }
    const hero = await open(browser, { width: 390, path: '/?showcase' });
    assert.equal(
      await hero.page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert.ok(
      (await hero.page.locator('.pub-orbit-caption').innerText()).includes(
        'Illustration',
      ),
    );
    await hero.page.screenshot({
      path: resolve(screenshots, 'showcase-mobile.png'),
      fullPage: true,
    });
    await hero.context.close();
    const desktop = await open(browser, { width: 1440, path: '/?showcase' });
    await desktop.page.screenshot({
      path: resolve(screenshots, 'showcase-desktop.png'),
      fullPage: true,
    });
    await desktop.context.close();
  } finally {
    await browser.close();
  }
});
