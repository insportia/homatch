// SS.ge — the listing form at home.ss.ge, driven through the HOMATCH account's session.
//
// SOURCE OF EVERY SELECTOR: the owner's MCP exploration of SS.ge — the
// sanitized 317-action recording (steps 63, 97-104, 184, 210, 216) as distilled
// into publishing-extension/adapters/ssge/adapter.js (fa1220c7, removed in
// 32fee61f): field names (totalArea, floor, floors, house-number, rooms,
// bedrooms, price, contactName, phone, city, district, street), the category /
// deal / condition texts, the currency buttons and the description placeholder.
// The recording itself (and its 81 candidate selectors) was never committed.
//
// WHAT THE EXPLORATION DID NOT RECORD, so this adapter refuses rather than guesses:
//   - the navigation from home.ss.ge to the creation form (the form must be the
//     page the configured create URL opens, or CREATE stops with CREATE_NAVIGATION_NOT_RECORDED);
//   - the photo-upload completion marker;
//   - the final free-publication control and the result URL — so CREATE always ends
//     at PREPARED (filled and verified, nothing submitted), even with live-submit approval;
//   - every management workflow (edit, price, photos, pause, reactivate, delete).

import type { Page } from 'playwright';
import { CAPABILITIES } from '../capabilities.js';
import { type OpContext, type OpResult, type PortalAdapter, type Task, StopError, blocked } from '../contract.js';
import { attachPhotos, autocomplete, choose, clean, exactlyOne, field, isChosen, nationalPhone, readValue, setValue } from '../form.js';
import { publicStatus } from './myhome.js';

const F = {
  area: { names: ['totalArea'], labels: ['საერთო ფართი'] },
  floor: { names: ['floor'], labels: ['სართული'] },
  totalFloors: { names: ['floors'], labels: ['სართულიანობა'] },
  streetNumber: { names: ['house-number'], labels: ['სახლის ნომერი'] },
  rooms: { names: ['rooms'], labels: ['ოთახები', 'ოთახების რაოდენობა'] },
  bedrooms: { names: ['bedrooms'], labels: ['საძინებლები', 'საძინებელი'] },
  price: { names: ['price', 'totalPrice'], labels: ['ფასი'] },
  contactName: { names: ['contactName'], labels: ['სახელი გამოჩნდება თქვენს გაცხადებაზე'] },
  contactPhone: { names: ['phone', 'contactPhone'], labels: ['ტელეფონის ნომერი'] },
  city: { names: ['city'], labels: ['ქალაქი', 'მდებარეობა'] },
  district: { names: ['district'], labels: ['უბანი', 'რაიონი'] },
  street: { names: ['street'], labels: ['ქუჩა'] },
} as const;
const TYPES: Record<string, string> = { APARTMENT: 'ბინა', HOUSE: 'კერძო სახლი', LAND: 'მიწის ნაკვეთი', COMMERCIAL: 'კომერციული ფართი' };
const DEALS: Record<string, string> = { SALE: 'იყიდება', RENT: 'ქირავდება', DAILY_RENT: 'ქირავდება დღიურად' };
/** HOMATCH condition → the recorded SS.ge choice. GOOD / UNDER_CONSTRUCTION have no recorded equivalent. */
const CONDITIONS: Record<string, string> = { NEW: 'ახალი გარემონტებული', NEEDS_RENOVATION: 'სარემონტო' };
const CURRENCY: Record<string, string> = { USD: '$ გამოჩნდეს საიტზე', GEL: '₾ გამოჩნდეს საიტზე' };
const LISTING_URL = /^https:\/\/(home\.|www\.)?ss\.ge\/.*?(\d{6,12})\/?$/;

async function signedIn(page: Page): Promise<'VALID' | 'AUTH_REQUIRED' | 'UNKNOWN'> {
  const secret = page.locator('input[type=password], input[autocomplete=one-time-code]');
  for (let i = 0; i < await secret.count(); i++) if (await secret.nth(i).isVisible()) return 'AUTH_REQUIRED';
  if (await page.locator('input[name=totalArea]').isVisible().catch(() => false)) return 'VALID';
  return 'UNKNOWN';
}

async function create(ctx: OpContext): Promise<OpResult> {
  const { page, task } = ctx;
  if (task.submitAlreadyStarted) return { outcome: 'RECONCILIATION_REQUIRED', error: 'SUBMIT_ALREADY_STARTED' };
  const x = task.listing!;
  if (!TYPES[x.propertyType]) throw blocked('PROPERTY_TYPE_NOT_RECORDED');
  if (!DEALS[x.dealType]) throw blocked('DEAL_TYPE_NOT_RECORDED');
  if (!CURRENCY[x.currency]) throw blocked('UNSUPPORTED_CURRENCY');
  if (!task.copies?.ka) throw blocked('GEORGIAN_DESCRIPTION_REQUIRED');
  if (!task.account.contactPhone) throw blocked('ACCOUNT_PHONE_REQUIRED');

  await ctx.stage('OPENING');
  const resp = await page.goto(task.portal.createUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  if (resp && resp.status() >= 500) throw new StopError('PORTAL_ERROR', true);
  if (resp && (resp.status() === 403 || resp.status() === 429)) throw blocked('PORTAL_REFUSED_AUTOMATION');
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
  const state = await signedIn(page);
  if (state === 'AUTH_REQUIRED') throw blocked('AUTH_REQUIRED');
  if (state !== 'VALID') throw blocked('CREATE_NAVIGATION_NOT_RECORDED');

  await ctx.stage('FILLING');
  const skipped: string[] = [];
  await choose(page, TYPES[x.propertyType]); await ctx.pause();
  await choose(page, DEALS[x.dealType]); await ctx.pause();
  if (x.condition) { if (CONDITIONS[x.condition]) { await choose(page, CONDITIONS[x.condition]); } else skipped.push('condition'); }
  if (x.amenities.length) skipped.push('amenities');
  if (x.bathrooms != null) skipped.push('bathrooms');
  await autocomplete(page, await field(page, F.city, 'city'), x.city, x.city, 'city'); await ctx.pause();
  if (x.district) await autocomplete(page, await field(page, F.district, 'district'), x.district, x.district, 'district');
  if (x.street) await autocomplete(page, await field(page, F.street, 'street'), x.street, x.street, 'street');
  const values: Record<string, string | number | null | undefined> = {
    area: x.area, floor: x.floor, totalFloors: x.totalFloors, streetNumber: x.streetNumber || null, rooms: x.rooms, bedrooms: x.bedrooms,
    price: x.price, contactName: 'HOMATCH', contactPhone: nationalPhone(task.account.contactPhone),
  };
  for (const [k, v] of Object.entries(values)) {
    if (v == null || v === '') continue;
    await setValue(await field(page, F[k as keyof typeof F], k), v); await ctx.pause(150);
  }
  await choose(page, CURRENCY[x.currency]);
  for (const lang of ['ka', 'en', 'ru'] as const) {
    const c = task.copies?.[lang];
    if (!c) continue;
    let area = page.locator(`textarea[name="description_${lang}"], textarea[lang="${lang}"]`);
    if (lang === 'ka' && !(await area.count())) area = page.getByPlaceholder('ჩაწერე აქ...', { exact: true });
    await setValue(await exactlyOne(area, `description.${lang}`), c.description); await ctx.pause();
  }
  if (ctx.photos.length) {
    await ctx.stage('UPLOADING');
    await attachPhotos(page, ctx.photos.slice(0, 16));
    skipped.push('photo_upload_completion_unverified');
  }

  await ctx.stage('VERIFYING');
  const errors: string[] = [];
  for (const [k, v] of Object.entries(values)) {
    if (v == null || v === '') continue;
    if (clean(await readValue(await field(page, F[k as keyof typeof F], k))) !== clean(v)) errors.push(k);
  }
  for (const text of [TYPES[x.propertyType], DEALS[x.dealType], CURRENCY[x.currency]]) {
    const el = page.locator('button, label, [role=radio], [role=option]').filter({ hasText: new RegExp(`^\\s*${text.replace(/[$.]/g, '\\$&')}\\s*$`) });
    if (!(await isChosen(await exactlyOne(el, text)))) errors.push(`choice:${text}`);
  }
  if (await page.locator('[aria-invalid=true]:visible, input:invalid:visible, textarea:invalid:visible').count()) errors.push('PORTAL_VALIDATION');
  if (errors.length) throw blocked(`FORM_VERIFICATION_FAILED:${errors.join(',')}`);
  await ctx.screenshot('READY_TO_SUBMIT');
  // The free-publication control and the result page were not recorded: stop here.
  return { outcome: 'PREPARED', error: 'PUBLISH_CONTROL_NOT_RECORDED', result: { fields: skipped } };
}

export const ssge: PortalAdapter = {
  id: 'ssge',
  capabilities: CAPABILITIES.ssge,
  async checkSession(page: Page, task: Task) {
    await page.goto(task.portal.createUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
    return signedIn(page);
  },
  async run(kind, ctx) {
    if (kind === 'CREATE') return create(ctx);
    if (kind === 'STATUS') return publicStatus(ctx, LISTING_URL);
    return { outcome: 'BLOCKED', error: 'OPERATION_NOT_EXPLORED' };
  },
};
