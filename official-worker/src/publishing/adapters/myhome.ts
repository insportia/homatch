// MyHome.ge — the statement form at statements.myhome.ge, driven through the
// HOMATCH account's session.
//
// SOURCE OF EVERY SELECTOR: the owner's MCP exploration of the MyHome statement
// form, as committed in publishing-extension/adapters/myhome/adapter.js
// (805ec2c5, removed from the tree in 32fee61f): the Georgian field labels, the
// `total_price` input, the category / deal choice texts, the location
// autocompletes, the phone-verified marker, the free-publication text next to
// the "გამოქვეყნება" button and the /pr/<id> result URL. Nothing here was invented.
//
// Level FIXTURE_TESTED: exercised against a local fixture page built from those
// recorded controls (test/publishingAdapters.test.mjs), NOT yet against the live
// portal. Management (edit / price / description / photos / pause / reactivate /
// delete) was never recorded, so those operations are NOT_EXPLORED and refused.

import type { Page } from 'playwright';
import { CAPABILITIES } from '../capabilities.js';
import { type OpContext, type OpResult, type PortalAdapter, type Task, StopError, blocked } from '../contract.js';
import { attachPhotos, autocomplete, choose, clean, exactlyOne, field, isChosen, nationalPhone, readValue, setValue, waitForUploads } from '../form.js';

const DEALS: Record<string, string> = { SALE: 'იყიდება', RENT: 'ქირავდება', DAILY_RENT: 'ქირავდება დღიურად' };
const TYPES: Record<string, string> = { APARTMENT: 'ბინა' };
const LABELS = {
  streetNumber: 'ქუჩის ნომერი', area: 'ფართი', floor: 'სართული', totalFloors: 'სართულები სულ',
  rooms: 'ოთახები', bedrooms: 'საძინებლები', contactName: 'სახელი', contactPhone: 'ტელეფონის ნომერი',
} as const;
/** The recorded upload-completion markers. The exploration flagged these as needing live confirmation. */
const UPLOADED = '[data-upload-status="complete"], [data-testid="uploaded-photo"]';
const RESULT = /^https:\/\/(www\.)?myhome\.ge\/(?:[a-z]{2}\/)?pr\/(\d{5,12})(?:\/|$)/;

async function signedIn(page: Page): Promise<'VALID' | 'AUTH_REQUIRED' | 'UNKNOWN'> {
  const host = page.url().match(/^https?:\/\/([^/:]+)/)?.[1] ?? '';
  if (host.endsWith('auth.tnet.ge')) return 'AUTH_REQUIRED';
  const login = page.locator('a, button').filter({ hasText: /^\s*(შესვლა|ავტორიზაცია)\s*$/ });
  for (let i = 0; i < await login.count(); i++) if (await login.nth(i).isVisible()) return 'AUTH_REQUIRED';
  if (await page.locator('input[name=total_price]').isVisible().catch(() => false)) return 'VALID';
  return 'UNKNOWN';
}

async function openForm(ctx: OpContext) {
  await ctx.stage('OPENING');
  const resp = await ctx.page.goto(ctx.task.portal.createUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  if (resp && resp.status() >= 500) throw new StopError('PORTAL_ERROR', true);
  if (resp && (resp.status() === 403 || resp.status() === 429)) throw blocked('PORTAL_REFUSED_AUTOMATION');
  await ctx.page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
  const state = await signedIn(ctx.page);
  if (state === 'AUTH_REQUIRED') throw blocked('AUTH_REQUIRED');
  if (state !== 'VALID') throw blocked('FORM_NOT_REACHED');
}

async function fill(ctx: OpContext): Promise<string[]> {
  const { page, task } = ctx;
  const x = task.listing!;
  const copy = task.copies?.ka;
  if (!copy) throw blocked('GEORGIAN_DESCRIPTION_REQUIRED');
  if (!TYPES[x.propertyType]) throw blocked('PROPERTY_TYPE_NOT_RECORDED');
  if (!DEALS[x.dealType]) throw blocked('DEAL_TYPE_NOT_RECORDED');
  if (x.currency !== 'USD') throw blocked('CURRENCY_CONTROL_NOT_RECORDED');
  if (!task.account.contactPhone) throw blocked('ACCOUNT_PHONE_REQUIRED');
  const skipped: string[] = [];

  await ctx.stage('FILLING');
  await choose(page, TYPES[x.propertyType]); await ctx.pause();
  await choose(page, DEALS[x.dealType]); await ctx.pause();
  // Condition / amenities: the exploration recorded no mapping from HOMATCH's
  // values to MyHome's texts; they are reported, never silently dropped.
  if (x.condition) skipped.push('condition');
  if (x.amenities.length) skipped.push('amenities');
  if (x.bathrooms != null) skipped.push('bathrooms');

  await autocomplete(page, await field(page, { labels: ['მდებარეობა'] }, 'city'), x.city, x.city, 'city'); await ctx.pause();
  if (x.street) await autocomplete(page, await field(page, { labels: ['ქუჩა'] }, 'street'), x.street, `${x.street}, ${x.city}`, 'street');
  await setValue(await field(page, { names: ['total_price'], labels: ['ფასი'] }, 'price'), x.price!); await ctx.pause();
  const values: Partial<Record<keyof typeof LABELS, string | number>> = {
    streetNumber: x.streetNumber || undefined, area: x.area ?? undefined, floor: x.floor ?? undefined, totalFloors: x.totalFloors ?? undefined,
    rooms: x.rooms ?? undefined, bedrooms: x.bedrooms ?? undefined,
    // The portal's contact = the HOMATCH account; the owner is only in the footer.
    contactName: 'HOMATCH', contactPhone: nationalPhone(task.account.contactPhone),
  };
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined || v === '') continue;
    await setValue(await field(page, { labels: [LABELS[k as keyof typeof LABELS]] }, k), v); await ctx.pause(150);
  }
  for (const lang of ['ka', 'en', 'ru'] as const) {
    const c = task.copies?.[lang];
    if (!c) continue;
    let area = page.locator(`textarea[lang="${lang}"], textarea[name="description_${lang}"]`);
    if (lang === 'ka' && !(await area.count())) area = page.locator('textarea');
    await setValue(await exactlyOne(area, `description.${lang}`), c.description); await ctx.pause();
  }
  // No unrequested cross-posting: MyHome offers Livo.ge on the same form.
  const livo = page.locator('label').filter({ hasText: /livo/i });
  for (let i = 0; i < await livo.count(); i++) {
    const box = livo.nth(i).locator('input[type=checkbox]');
    if (await box.count() && await box.isChecked()) { await box.uncheck(); skipped.push('livo_crosspost_unchecked'); }
  }

  if (ctx.photos.length) {
    await ctx.stage('UPLOADING');
    await attachPhotos(page, ctx.photos.slice(0, 16));
    await waitForUploads(page, UPLOADED, Math.min(16, ctx.photos.length));
  }
  return skipped;
}

/** Read every value back from the page; any difference stops before submit. */
async function verify(ctx: OpContext) {
  const { page, task } = ctx;
  const x = task.listing!;
  await ctx.stage('VERIFYING');
  const errors: string[] = [];
  if (Number(await readValue(await field(page, { names: ['total_price'] }, 'price'))) !== x.price) errors.push('price');
  const expect: Record<string, string> = { contactPhone: nationalPhone(task.account.contactPhone) };
  if (x.area != null) expect.area = String(x.area);
  if (x.rooms != null) expect.rooms = String(x.rooms);
  if (x.floor != null) expect.floor = String(x.floor);
  for (const [k, v] of Object.entries(expect)) {
    const got = clean(await readValue(await field(page, { labels: [LABELS[k as keyof typeof LABELS]] }, k))).replace(/\s/g, '');
    if (got !== v.replace(/\s/g, '')) errors.push(k);
  }
  for (const text of [TYPES[x.propertyType], DEALS[x.dealType]]) {
    const el = page.locator('button, label, [role=radio], [role=option]').filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) });
    if (!(await isChosen(await exactlyOne(el, text)))) errors.push(`choice:${text}`);
  }
  const currency = page.locator('input[name=currency], select[name=currency]');
  if ((await currency.count()) !== 1 || (await readValue(currency)) !== 'USD') errors.push('currency');
  if (errors.length) throw blocked(`FORM_VERIFICATION_FAILED:${errors.join(',')}`);
  // A one-time code on screen is the portal asking a person — never automated.
  if (await page.getByLabel('კოდი', { exact: true }).isVisible().catch(() => false)) throw blocked('OTP_REQUIRED');
  const phone = await field(page, { labels: [LABELS.contactPhone] }, 'contactPhone');
  const group = phone.locator('xpath=ancestor::label/..');
  if (!/დადასტურებულია|ვერიფიცირებული/.test(await group.textContent().catch(() => '') ?? '')) throw blocked('PHONE_VERIFICATION_REQUIRED');
  const publish = await exactlyOne(page.locator('button').filter({ hasText: /^\s*გამოქვეყნება\s*$/ }), 'publish');
  if (await publish.isDisabled()) throw blocked('PUBLISH_BUTTON_DISABLED');
  // Only the free publication: any paid option on the final step stops the operation.
  const area = await publish.locator('xpath=ancestor::*[self::section or self::footer or self::form][1]').textContent().catch(() => '');
  if (!/უფასო/.test(area ?? '')) throw blocked('FREE_PUBLICATION_NOT_VERIFIED');
  return publish;
}

async function create(ctx: OpContext): Promise<OpResult> {
  if (ctx.task.submitAlreadyStarted) return { outcome: 'RECONCILIATION_REQUIRED', error: 'SUBMIT_ALREADY_STARTED' };
  await openForm(ctx);
  const skipped = await fill(ctx);
  const publish = await verify(ctx);
  await ctx.screenshot('READY_TO_SUBMIT');
  if (!ctx.task.account.liveSubmitApproved) return { outcome: 'PREPARED', result: { fields: skipped } };
  if (!(await ctx.markSubmitting())) return { outcome: 'RECONCILIATION_REQUIRED', error: 'SUBMIT_DOOR_CLOSED' };
  await publish.click();
  await ctx.stage('CONFIRMING');
  try {
    await ctx.page.waitForURL(RESULT, { timeout: 60_000 });
  } catch {
    await ctx.screenshot('NO_RESULT_URL');
    // The click happened; whether the portal created the listing is unknown.
    return { outcome: 'RECONCILIATION_REQUIRED', error: 'NO_RESULT_URL' };
  }
  const m = ctx.page.url().match(RESULT)!;
  await ctx.screenshot('CREATED');
  return { outcome: 'SUCCEEDED', result: { externalUrl: ctx.page.url(), externalId: m[2], fields: skipped } };
}

/** The public listing page in a real browser: 404/410 gone, the id in the page live. */
export async function publicStatus(ctx: OpContext, pattern: RegExp): Promise<OpResult> {
  const url = ctx.task.publication?.externalUrl;
  const id = ctx.task.publication?.externalId;
  if (!url || !id) return { outcome: 'BLOCKED', error: 'NOTHING_TO_CHECK' };
  if (!pattern.test(url)) return { outcome: 'BLOCKED', error: 'URL_NOT_ON_PORTAL' };
  await ctx.stage('CHECKING');
  const resp = await ctx.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  const code = resp?.status() ?? 0;
  if (code === 404 || code === 410) return { outcome: 'SUCCEEDED', result: { state: 'GONE' } };
  if (code === 200 && (await ctx.page.content()).includes(id)) return { outcome: 'SUCCEEDED', result: { state: 'LIVE' } };
  return { outcome: 'FAILED', error: code >= 500 ? 'PORTAL_ERROR' : `STATUS_UNKNOWN_HTTP_${code}`, retryable: code >= 500 };
}

export const myhome: PortalAdapter = {
  id: 'myhome',
  capabilities: CAPABILITIES.myhome,
  async checkSession(page: Page, task: Task) {
    await page.goto(task.portal.createUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
    return signedIn(page);
  },
  async run(kind, ctx) {
    if (kind === 'CREATE') return create(ctx);
    if (kind === 'STATUS') return publicStatus(ctx, RESULT);
    return { outcome: 'BLOCKED', error: 'OPERATION_NOT_EXPLORED' };
  },
};
