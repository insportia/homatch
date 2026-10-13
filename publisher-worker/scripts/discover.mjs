/** Read-only rendered-DOM discovery. Does not authenticate, enter data or submit any form. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { chromium } from 'playwright-core';

const domains = [
  'myhome.ge',
  'ss.ge',
  'livo.ge',
  'home.ge',
  'korter.ge',
  'place.ge',
  'area.ge',
  'gancxadebebi.ge',
  'binebi.ge',
  'dgiurad.ge',
];
const requested = process.argv.slice(2);
if (requested.some((domain) => !domains.includes(domain)))
  throw new Error('UNKNOWN_DISCOVERY_DOMAIN');
const selected = requested.length ? requested : domains;
const output = resolve('publisher-worker/artifacts/discovery.json');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PUBLISHER_CHROME_PATH
    ? { executablePath: process.env.PUBLISHER_CHROME_PATH }
    : {}),
});
const records = [];
let networkDenied = 0;
try {
  for (const domain of selected) {
    const context = await browser.newContext({
      serviceWorkers: 'block',
      acceptDownloads: false,
    });
    const page = await context.newPage();
    try {
      await page.goto(`https://${domain}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      await page.locator('body').waitFor({ state: 'visible', timeout: 10_000 });
      const controls = await page
        .locator('a,button,input,select,textarea')
        .evaluateAll((elements) =>
          elements
            .map((element) => {
              // Never read input values, hidden fields, page storage, cookies or network bodies.
              const href = element.getAttribute('href');
              let destination = null;
              try {
                const url = new URL(href, location.href);
                if (url.protocol === 'https:')
                  destination = url.origin + url.pathname;
              } catch {}
              return {
                tag: element.tagName,
                role: element.getAttribute('role'),
                type: element.getAttribute('type'),
                name: element.getAttribute('name'),
                label: element.getAttribute('aria-label'),
                text:
                  element.tagName === 'INPUT'
                    ? null
                    : element.textContent?.trim().slice(0, 100),
                destination,
              };
            })
            .filter((control) => control.type !== 'hidden')
            .slice(0, 200),
        );
      const url = new URL(page.url());
      records.push({
        domain,
        checkedAt: new Date().toISOString(),
        url: url.origin + url.pathname,
        state: 'DISCOVERED',
        title: await page.title(),
        controls,
      });
      console.log(
        `${domain}: rendered DOM collected; no auth/submission performed`,
      );
    } catch (error) {
      const denied = String(error.message).includes(
        'ERR_NETWORK_ACCESS_DENIED',
      );
      if (denied) networkDenied += 1;
      records.push({
        domain,
        checkedAt: new Date().toISOString(),
        state: 'BLOCKED',
        code: denied ? 'ENVIRONMENT_NETWORK_DENIED' : 'DISCOVERY_FAILED',
      });
      console.log(
        `${domain}: ${denied ? 'environment network denied' : 'discovery failed'}`,
      );
    } finally {
      await context.close();
    }
    // An environment-wide network block cannot be solved by repeatedly opening portals.
    if (networkDenied >= 2) break;
  }
} finally {
  await browser.close();
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    JSON.stringify({ mode: 'read_only', records }, null, 2),
  );
}
if (
  records.some((r) => r.state === 'BLOCKED') ||
  records.length !== selected.length
)
  process.exitCode = 1;
