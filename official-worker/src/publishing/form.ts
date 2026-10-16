// Form primitives for portal adapters — native Playwright actions (real typing,
// real clicks, real file chooser input), with the exploration's discipline: every
// control must resolve to exactly ONE visible element, located by a recorded
// name / label / placeholder — never by a generated CSS class.

import type { Locator, Page } from 'playwright';
import { StopError, blocked } from './contract.js';

export const clean = (v: unknown) => String(v ?? '').replace(/\*/g, '').replace(/\s+/g, ' ').trim();

async function visibleOnly(loc: Locator): Promise<Locator[]> {
  const out: Locator[] = [];
  const n = await loc.count();
  for (let i = 0; i < n; i++) { const one = loc.nth(i); if (await one.isVisible().catch(() => false)) out.push(one); }
  return out;
}

/** Exactly one visible match, or a MISSING_/AMBIGUOUS_ stop naming the field. */
export async function exactlyOne(loc: Locator, field: string): Promise<Locator> {
  const xs = await visibleOnly(loc);
  if (xs.length !== 1) throw blocked(`${xs.length ? 'AMBIGUOUS' : 'MISSING'}_FIELD:${field}`);
  return xs[0];
}

export interface FieldSpec { names?: readonly string[]; labels?: readonly string[]; placeholders?: readonly string[] }

/** A form control by recorded name first, then exact label / aria-label / placeholder. */
export async function field(page: Page, spec: FieldSpec, key: string): Promise<Locator> {
  for (const name of spec.names ?? []) {
    const byName = page.locator(`input[name="${name}"], textarea[name="${name}"], select[name="${name}"]`);
    if ((await visibleOnly(byName)).length) return exactlyOne(byName, key);
  }
  const candidates: Locator[] = [];
  for (const label of spec.labels ?? []) {
    for (const loc of [page.getByLabel(label, { exact: true }), page.locator(`[aria-label="${label}"]`)]) candidates.push(...await visibleOnly(loc));
  }
  for (const ph of spec.placeholders ?? []) candidates.push(...await visibleOnly(page.getByPlaceholder(ph, { exact: true })));
  // The same element can match through label and aria-label; compare by handle.
  const unique: Locator[] = [];
  for (const c of candidates) {
    const h = await c.elementHandle();
    let dup = false;
    for (const u of unique) if (await (await u.elementHandle())?.evaluate((a, b) => a === b, h)) dup = true;
    if (!dup) unique.push(c);
  }
  if (unique.length !== 1) throw blocked(`${unique.length ? 'AMBIGUOUS' : 'MISSING'}_FIELD:${key}`);
  return unique[0];
}

/** Type a value like a person (select: choose the option by its visible text). */
export async function setValue(loc: Locator, value: string | number) {
  const tag = await loc.evaluate((e) => e.tagName);
  if (tag === 'SELECT') await loc.selectOption({ label: String(value) });
  else { await loc.click(); await loc.fill(String(value)); await loc.blur(); }
}

export async function readValue(loc: Locator): Promise<string> {
  return loc.evaluate((e: any) => (e.tagName === 'SELECT' ? e.selectedOptions?.[0]?.textContent ?? '' : e.value ?? ''));
}

/** A choice (button / radio / option) whose whole visible text is exactly `text`. Never a submit button. */
export async function choose(page: Page, text: string) {
  const loc = page.locator('button, label, [role=radio], [role=option], [role=tab]').filter({ hasText: new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) });
  const el = await exactlyOne(loc, `choice:${text}`);
  if (await el.evaluate((e: any) => e.tagName === 'BUTTON' && e.type === 'submit')) throw blocked('UNSAFE_SUBMIT_CONTROL');
  await el.click();
  return el;
}

export async function isChosen(el: Locator): Promise<boolean> {
  return el.evaluate((e: any) => e.checked === true || e.querySelector?.('input')?.checked === true
    || ['aria-checked', 'aria-selected', 'aria-pressed'].some((k) => e.getAttribute(k) === 'true'));
}

/** Autocomplete: type, wait for exactly one option with the exact text, pick it, confirm the field took it. */
export async function autocomplete(page: Page, input: Locator, value: string, optionText: string, key: string) {
  await input.click();
  await input.fill(value);
  const option = page.getByRole('option', { name: optionText, exact: true });
  try { await option.first().waitFor({ state: 'visible', timeout: 8000 }); } catch { throw blocked(`LOCATION_SELECTION_REQUIRED:${key}`); }
  if ((await visibleOnly(option)).length !== 1) throw blocked(`AMBIGUOUS_LOCATION:${key}`);
  await option.first().click();
  const got = clean(await readValue(input));
  if (got !== clean(value) && got !== clean(optionText)) throw blocked(`LOCATION_NOT_VERIFIED:${key}`);
}

/** The single file input, given the photos as real files. Dispatch is not completion. */
export async function attachPhotos(page: Page, files: Array<{ name: string; mimeType: string; buffer: Buffer }>) {
  const inputs = page.locator('input[type=file]:not([disabled])');
  if ((await inputs.count()) !== 1) throw blocked('PHOTO_INPUT_AMBIGUOUS');
  await inputs.setInputFiles(files);
}

/** Wait until the portal itself shows `n` uploaded photos (recorded completion marker), or stop. */
export async function waitForUploads(page: Page, markerSelector: string, n: number, timeoutMs = 90_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const count = (await visibleOnly(page.locator(markerSelector))).length;
    if (count === n) return;
    if (count > n) throw blocked('PHOTO_COUNT_MISMATCH');
    await page.waitForTimeout(500);
  }
  throw new StopError('PHOTO_COMPLETION_NOT_VERIFIED', true);
}

/** Georgian mobile in the national format the portals' phone fields take (995 prefix dropped). */
export const nationalPhone = (e164: string | null) => (e164 ?? '').replace(/^\+995/, '').replace(/\D/g, '');

/**
 * The page's controls as EVIDENCE for selectors — labels, names, placeholders,
 * types, roles, option and button texts, and the URL. Never a value: nothing a
 * person typed, no hidden field, no password, no cookie.
 */
export interface Inventory {
  url: string; title: string; fileInputs: number;
  fields: Array<{ tag: string; type: string | null; name: string | null; id: string | null; label: string | null; placeholder: string | null; required: boolean; visible: boolean; autocomplete: string | null; options?: string[]; testid: string | null }>;
  controls: Array<{ tag: string; role: string | null; text: string; type: string | null; href: string | null; testid: string | null; pressed: string | null }>;
}
// In-page code as plain JavaScript (the worker builds without DOM typings).
const INVENTORY_JS = `(() => {
  const vis = (e) => !!e.getClientRects().length;
  const text = (e) => ((e && e.textContent) || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
  const fields = Array.from(document.querySelectorAll('input, textarea, select')).filter((e) => e.type !== 'hidden').map((el) => ({
    tag: el.tagName.toLowerCase(), type: el.type || null, name: el.name || null, id: el.id || null,
    label: Array.from(el.labels || []).map(text).join(' | ') || el.getAttribute('aria-label') || null,
    placeholder: el.placeholder || null, required: !!el.required, visible: vis(el), autocomplete: el.getAttribute('autocomplete'),
    options: el.tagName === 'SELECT' ? Array.from(el.options).map((o) => (o.textContent || '').trim()).slice(0, 40) : undefined,
    testid: el.getAttribute('data-testid'),
  }));
  const controls = Array.from(document.querySelectorAll('button, [role=button], [role=radio], [role=option], [role=tab], [role=checkbox], a[href]'))
    .filter(vis).slice(0, 300).map((e) => ({ tag: e.tagName.toLowerCase(), role: e.getAttribute('role'), text: text(e), type: e.type || null,
      href: e.tagName === 'A' ? e.href.replace(/[?#].*$/, '') : null, testid: e.getAttribute('data-testid'),
      pressed: e.getAttribute('aria-pressed') || e.getAttribute('aria-checked') || e.getAttribute('aria-selected') }));
  return { url: location.origin + location.pathname, title: document.title.slice(0, 120), fields, controls, fileInputs: document.querySelectorAll('input[type=file]').length };
})()`;

/**
 * The page's controls as EVIDENCE for selectors — labels, names, placeholders,
 * types, roles, option and button texts, and the URL. Never a value: nothing a
 * person typed, no hidden field, no password, no cookie.
 */
export async function inventory(page: Page): Promise<Inventory> {
  return page.evaluate(INVENTORY_JS) as Promise<Inventory>;
}
