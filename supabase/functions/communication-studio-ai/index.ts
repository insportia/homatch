// HOMATCH — Communication Studio AI: drafting help for Email Studio and the
// private-message assistant.
//
// IT DRAFTS. IT NEVER SENDS. Every action returns text or an email design for
// the customer to accept, edit or reject; sending stays in outreach-send (email)
// or in the customer's own hands (profile links), behind an explicit confirm.
//
// GROUNDED IN REAL DATA. When a property is named, its facts and its PUBLIC
// photos are read here, through the CALLER's own client, so RLS decides whether
// the property is theirs. The model is told to use those facts and nothing else,
// and image blocks may only point at those photos by index — a URL the model
// writes is discarded. Contact details, the private phone and the exact address
// are never sent to the model.
//
// GUARDS. Real-estate domain gate on the instruction (the same classifier
// comm-agent uses), a per-user hourly rate limit, a bounded output budget, and
// every design passes sanitizeDesign() before it leaves this function. Model
// usage is recorded in cost_events with UNPRICED when the price book has no rate
// — never a silent zero.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { authenticate, serviceClient, json, preflight, checkRateLimit, logEvent } from '../_shared/comm/auth.ts';
import { callLlm, llmAvailable } from '../_shared/comm/llm.ts';
import { classifyDomain } from '../_shared/comm/generated/domainClassifier.ts';
import { estimatedProviderCost } from '../_shared/providerCost.ts';
import {
  type Block, type EmailDesign, inlineToText, sanitizeDesign, sanitizeInline, THEMES,
} from '../../../src/communication/emailDesign.ts';

type Action =
  | 'compose_email' | 'variations' | 'rewrite' | 'subjects' | 'cta' | 'compose_message' | 'personalize';
type RewriteMode = 'improve' | 'shorten' | 'professional' | 'persuasive' | 'translate' | 'expand';
type MessageChannel = 'WHATSAPP' | 'TELEGRAM' | 'SMS' | 'HOMATCH_CHAT' | 'PROFILE_DM';

interface StudioRequest {
  action: Action;
  language?: string;
  propertyId?: string | null;
  instruction?: string;
  mode?: RewriteMode;
  targetLanguage?: string;
  text?: string;
  subject?: string;
  design?: unknown;
  channel?: MessageChannel;
  recipientName?: string | null;
  recipientLanguage?: string | null;
}

const LANGS: Record<string, string> = { ka: 'Georgian', en: 'English', ru: 'Russian', ar: 'Arabic', he: 'Hebrew', tr: 'Turkish' };
const CHANNEL_LIMIT: Record<MessageChannel, number> = { WHATSAPP: 1000, TELEGRAM: 1500, SMS: 320, HOMATCH_CHAT: 1500, PROFILE_DM: 900 };
const LIMIT_PER_HOUR = 40;

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const caller = await authenticate(req);
  if (!caller) return json({ error: 'unauthorized' }, 401);

  let body: StudioRequest;
  try { body = await req.json() as StudioRequest; } catch { return json({ error: 'bad_request' }, 400); }
  const actions: Action[] = ['compose_email', 'variations', 'rewrite', 'subjects', 'cta', 'compose_message', 'personalize'];
  if (!actions.includes(body.action)) return json({ error: 'unknown_action' }, 400);

  if (!llmAvailable()) return json({ ok: false, code: 'GENERATION_UNAVAILABLE' }, 503);

  const sb = serviceClient();
  const limit = await checkRateLimit(sb, 'communication_studio_ai', LIMIT_PER_HOUR, 3600, { userId: caller.userId });
  if (!limit.allowed) return json({ ok: false, code: 'RATE_LIMITED', retryAfter: limit.retryAfterSeconds }, 429);

  const instruction = String(body.instruction ?? '').slice(0, 1500);
  const gateText = [instruction, String(body.text ?? '').slice(0, 1500)].join('\n');
  const verdict = classifyDomain({ text: gateText, hasPropertyContext: Boolean(body.propertyId) });
  if (verdict.verdict === 'BLOCK') {
    logEvent('communication-studio-ai', 'blocked_input', { signals: verdict.signals.map((s) => s.code).join(',') });
    return json({ ok: false, code: 'OUT_OF_SCOPE' }, 422);
  }

  /* The property, read as the caller: RLS is the ownership check. */
  let property: PropertyContext | null = null;
  if (body.propertyId) {
    const { data: me } = await sb.from('users').select('id').eq('auth_id', caller.userId).maybeSingle();
    property = me ? await loadProperty(caller.sb, String(body.propertyId), String((me as { id: string }).id)) : null;
    if (!property) return json({ ok: false, code: 'PROPERTY_NOT_FOUND' }, 404);
  }

  const language = LANGS[String(body.language ?? 'en')] ? String(body.language) : 'en';
  try {
    switch (body.action) {
      case 'compose_email': return await composeEmail(sb, body, property, language, instruction, null);
      case 'variations': return await variations(sb, body, property, language, instruction);
      case 'rewrite': return await rewrite(sb, body, property, language);
      case 'subjects': return await subjects(sb, body, property, language);
      case 'cta': return await cta(sb, body, property, language);
      case 'compose_message': return await composeMessage(sb, body, property, language, instruction);
      case 'personalize': return await personalize(sb, body, language);
    }
  } catch (e) {
    logEvent('communication-studio-ai', 'failed', { action: body.action, error: String((e as Error)?.message ?? e).slice(0, 200) });
    return json({ ok: false, code: 'GENERATION_FAILED' }, 502);
  }
  return json({ ok: false, code: 'unknown_action' }, 400);
});

/* ── property context ────────────────────────────────────────────────────── */

interface PropertyContext {
  id: string;
  facts: Record<string, string | number | boolean>;
  photos: Array<{ index: number; url: string; landscape: boolean | null; cover: boolean }>;
}

type Sb = ReturnType<typeof serviceClient>;

/* The caller's OWN property only: a public listing someone else owns is not theirs to market. */
async function loadProperty(userSb: Sb, propertyId: string, ownerId: string): Promise<PropertyContext | null> {
  const { data: p } = await userSb.from('properties')
    .select('id,title,transaction_type,property_type,homatch_id,cover_photo_url,is_deleted')
    .eq('id', propertyId).eq('user_id', ownerId).maybeSingle();
  if (!p || (p as { is_deleted?: boolean }).is_deleted) return null;
  const { data: f } = await userSb.from('property_facts')
    .select('city,district,neighborhood,total_price,currency,area,rooms,bedrooms,bathrooms,floor,total_floors,new_build,parking,balcony,terrace,elevator,furnished,view,description,features,condition,cover_image,gallery_images,photo_visibility')
    .eq('property_id', propertyId).maybeSingle();
  const { data: photos } = await userSb.from('property_photos')
    .select('public_url,display_order,is_cover,visibility,width,height')
    .eq('property_id', propertyId).eq('visibility', 'PUBLIC').order('is_cover', { ascending: false }).order('display_order', { ascending: true }).limit(12);

  const facts: Record<string, string | number | boolean> = {};
  const put = (k: string, v: unknown) => { if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) facts[k] = Array.isArray(v) ? v.slice(0, 12).join(', ') : (v as string | number | boolean); };
  const pr = p as Record<string, unknown>;
  put('title', pr.title); put('transaction', pr.transaction_type); put('property_type', pr.property_type); put('homatch_id', pr.homatch_id);
  const fr = (f ?? {}) as Record<string, unknown>;
  for (const k of ['city', 'district', 'neighborhood', 'total_price', 'currency', 'area', 'rooms', 'bedrooms', 'bathrooms', 'floor', 'total_floors', 'new_build', 'parking', 'balcony', 'terrace', 'elevator', 'furnished', 'view', 'condition', 'features']) put(k, fr[k]);
  if (typeof fr.description === 'string') facts.description = fr.description.slice(0, 1500);

  const urls: Array<{ url: string; landscape: boolean | null; cover: boolean }> = [];
  for (const ph of (photos ?? []) as Array<Record<string, unknown>>) {
    const url = typeof ph.public_url === 'string' ? ph.public_url : '';
    if (!url.startsWith('https://')) continue;
    const w = Number(ph.width); const h = Number(ph.height);
    urls.push({ url, cover: Boolean(ph.is_cover), landscape: w > 0 && h > 0 ? w >= h : null });
  }
  /* Imported listing media, only when the listing's own photos are public. */
  if (fr.photo_visibility === 'PUBLIC') {
    const imported = [fr.cover_image, ...(Array.isArray(fr.gallery_images) ? fr.gallery_images : [])];
    for (const u of imported) if (typeof u === 'string' && u.startsWith('https://') && !urls.some((x) => x.url === u)) urls.push({ url: u, cover: u === fr.cover_image, landscape: null });
  }
  return { id: propertyId, facts, photos: urls.slice(0, 12).map((u, index) => ({ index, ...u })) };
}

function factsBlock(property: PropertyContext | null): string {
  if (!property) return 'PROPERTY FACTS: none were provided. Do not describe any specific property, price, size or location.';
  return `PROPERTY FACTS (the only facts you may state; never add, round up or embellish):\n${JSON.stringify(property.facts)}\n` +
    `PROPERTY PHOTOS available: ${property.photos.length} (refer to them only by "photo": <index>, 0-based; index 0 is the cover).`;
}

/* ── model call + usage ──────────────────────────────────────────────────── */

async function model(sb: Sb, action: string, system: string, user: string, maxTokens: number): Promise<unknown> {
  const r = await callLlm({ system, user, json: true, maxTokens, timeoutMs: 45_000 });
  await recordUsage(sb, action, r);
  if (!r.ok || !r.parsed || typeof r.parsed !== 'object') throw new Error(r.error ?? 'no_json');
  return r.parsed;
}

async function recordUsage(sb: Sb, action: string, r: { ok: boolean; inputTokens: number; outputTokens: number; model: string }) {
  if (r.inputTokens + r.outputTokens <= 0) return;
  try {
    const inCost = await estimatedProviderCost(sb, { provider: 'OPENAI', unit: 'INPUT_TOKEN', units: r.inputTokens, model: r.model });
    const outCost = await estimatedProviderCost(sb, { provider: 'OPENAI', unit: 'OUTPUT_TOKEN', units: r.outputTokens, model: r.model });
    const cost = inCost !== null && outCost !== null ? inCost + outCost : null;
    await sb.from('cost_events').insert({
      provider: 'OPENAI', operation_type: `COMM_STUDIO_${action.toUpperCase()}`, source: 'communication-studio-ai',
      units: r.inputTokens + r.outputTokens, cost_usd: cost ?? 0, success: r.ok, cache_hit: false,
      pricing_state: cost === null ? 'UNPRICED' : 'ESTIMATED',
    });
  } catch { /* usage telemetry never fails the draft */ }
}

const RULES = [
  'You write for HOMATCH, a Georgian real-estate platform, on behalf of a property owner or broker.',
  'Hard rules:',
  '- Use ONLY the property facts provided. Never invent specifications, prices, amenities, distances, availability or legal status.',
  '- Never invent anything about the recipient. Never claim the recipient is a buyer or tenant; they are a potentially interested person.',
  '- No pressure tactics, no false urgency, no guarantees of price, return or approval.',
  '- Write tbilisi as თბილისი in Georgian. Use plain, warm, professional language.',
  '- Merge fields allowed in text: {{first_name|fallback}} only. Do not invent other placeholders.',
].join('\n');

/* ── email design from the model ─────────────────────────────────────────── */

const DESIGN_SHAPE = `Reply with JSON only:
{"subject":"...","preheader":"...","theme":"gold|navy|ivory|slate","blocks":[
 {"type":"header","brand":"HOMATCH","tagline":"..."},
 {"type":"image","photo":0,"alt":"...","width":100,"caption":""},
 {"type":"heading","text":"...","level":1},
 {"type":"text","html":"... may use <b>, <i>, <br> ..."},
 {"type":"gallery","photos":[1,2,3]},
 {"type":"facts","items":[{"label":"...","value":"..."}]},
 {"type":"button","label":"...","href":"https://..."},
 {"type":"divider"},
 {"type":"footer","text":"..."}
]}
Use only block types listed. 4 to 12 blocks. Omit image/gallery blocks when no photos are available.
Only use a button href that the user's instruction provides; otherwise omit the button.`;

function designFromModel(parsed: Record<string, unknown>, property: PropertyContext | null): { subject: string; preheader: string; design: EmailDesign } {
  const photos = property?.photos ?? [];
  const pick = (i: unknown) => { const n = Number(i); return Number.isInteger(n) && n >= 0 && n < photos.length ? photos[n].url : ''; };
  const raw = Array.isArray(parsed.blocks) ? parsed.blocks as Array<Record<string, unknown>> : [];
  const blocks: unknown[] = raw.map((b) => {
    /* An image is a photo of THIS property, by index, or it is nothing. */
    if (b.type === 'image') return { ...b, src: pick(b.photo), align: b.align ?? 'center' };
    if (b.type === 'gallery') return { type: 'gallery', images: (Array.isArray(b.photos) ? b.photos : []).map((i) => ({ src: pick(i), alt: '' })) };
    return b;
  }).filter((b) => !((b as Record<string, unknown>).type === 'image' && !(b as Record<string, unknown>).src));
  const themeName = String(parsed.theme ?? 'gold') as keyof typeof THEMES;
  const design = sanitizeDesign({ version: 1, theme: THEMES[themeName] ?? THEMES.gold, blocks });
  return { subject: String(parsed.subject ?? '').slice(0, 200), preheader: String(parsed.preheader ?? '').slice(0, 200), design };
}

async function composeEmail(sb: Sb, body: StudioRequest, property: PropertyContext | null, language: string, instruction: string, layout: string | null): Promise<Response> {
  const base = body.design ? sanitizeDesign(body.design) : null;
  const system = `${RULES}\nYou design marketing emails as structured blocks.\n${DESIGN_SHAPE}`;
  const user = [
    `Write in ${LANGS[language]}.`,
    factsBlock(property),
    layout ? `Layout direction: ${layout}.` : '',
    base && base.blocks.length ? `Start from this existing design (keep its structure unless asked otherwise):\n${JSON.stringify(base.blocks.map(compactBlock))}` : '',
    `The owner's request:\n"""\n${instruction || 'Create an elegant, premium email presenting this property.'}\n"""`,
  ].filter(Boolean).join('\n\n');
  const parsed = await model(sb, 'compose_email', system, user, 1800) as Record<string, unknown>;
  const out = designFromModel(parsed, property);
  if (!out.design.blocks.length) throw new Error('empty_design');
  return json({ ok: true, ...out });
}

function compactBlock(b: Block): Record<string, unknown> {
  if (b.type === 'text') return { type: 'text', text: inlineToText(b.html).slice(0, 400) };
  if (b.type === 'image') return { type: 'image', alt: b.alt };
  if (b.type === 'gallery') return { type: 'gallery', count: b.images.length };
  return { ...b, id: undefined };
}

async function variations(sb: Sb, body: StudioRequest, property: PropertyContext | null, language: string, instruction: string): Promise<Response> {
  const layouts = [
    'hero photo first, short headline, two short paragraphs, facts, button',
    'headline first, three-photo gallery, compact facts, one paragraph',
    'minimal and text-led: headline, personal note, one photo, facts',
  ];
  const results = await Promise.allSettled(layouts.map(async (layout) => {
    const res = await composeEmail(sb, { ...body, design: null }, property, language, instruction, layout);
    return await res.json();
  }));
  const variants = results.filter((r): r is PromiseFulfilledResult<Record<string, unknown>> => r.status === 'fulfilled' && Boolean(r.value?.ok))
    .map((r) => ({ subject: r.value.subject, preheader: r.value.preheader, design: r.value.design }));
  if (!variants.length) throw new Error('no_variants');
  return json({ ok: true, variants });
}

const MODE_TEXT: Record<RewriteMode, string> = {
  improve: 'Improve clarity and flow without changing meaning.',
  shorten: 'Make it about half as long, keeping the essential points.',
  professional: 'Make the tone more professional and polished.',
  persuasive: 'Make it more persuasive and inviting, without exaggeration or invented claims.',
  translate: 'Translate it faithfully.',
  expand: 'Expand it a little with more helpful detail drawn only from the property facts.',
};

async function rewrite(sb: Sb, body: StudioRequest, property: PropertyContext | null, language: string): Promise<Response> {
  const text = sanitizeInline(String(body.text ?? ''), 4000);
  if (!inlineToText(text).trim()) return json({ ok: false, code: 'BAD_REQUEST' }, 400);
  const mode: RewriteMode = (Object.keys(MODE_TEXT) as RewriteMode[]).includes(body.mode as RewriteMode) ? body.mode as RewriteMode : 'improve';
  const target = mode === 'translate' && LANGS[String(body.targetLanguage)] ? String(body.targetLanguage) : language;
  const system = `${RULES}\nYou edit one passage of an email or message. Keep merge fields like {{first_name|...}} intact. You may use <b>, <i>, <br>.\nReply with JSON only: {"text":"..."}`;
  const user = [`${MODE_TEXT[mode]} Output language: ${LANGS[target]}.`, factsBlock(property), `Passage:\n"""\n${text}\n"""`, body.instruction ? `Extra request: ${body.instruction}` : ''].filter(Boolean).join('\n\n');
  const parsed = await model(sb, `rewrite_${mode}`, system, user, 900) as Record<string, unknown>;
  const out = sanitizeInline(String(parsed.text ?? ''), 4000);
  if (!out.trim()) throw new Error('empty');
  return json({ ok: true, text: out });
}

async function subjects(sb: Sb, body: StudioRequest, property: PropertyContext | null, language: string): Promise<Response> {
  const design = body.design ? sanitizeDesign(body.design) : null;
  const summary = design ? design.blocks.map(compactBlock).slice(0, 10) : [];
  const system = `${RULES}\nYou write email subject lines: clear, specific, under 70 characters, no clickbait, no ALL CAPS, at most one emoji.\nReply with JSON only: {"subjects":["...","...","..."]}`;
  const user = [`Language: ${LANGS[language]}.`, factsBlock(property), body.subject ? `Current subject: ${body.subject}` : '', `Email content: ${JSON.stringify(summary)}`].filter(Boolean).join('\n\n');
  const parsed = await model(sb, 'subjects', system, user, 400) as Record<string, unknown>;
  const list = (Array.isArray(parsed.subjects) ? parsed.subjects : []).map((s) => String(s).trim().slice(0, 120)).filter(Boolean).slice(0, 3);
  if (!list.length) throw new Error('empty');
  return json({ ok: true, subjects: list });
}

async function cta(sb: Sb, body: StudioRequest, property: PropertyContext | null, language: string): Promise<Response> {
  const system = `${RULES}\nYou write call-to-action button labels: 2 to 5 words, an honest next step (view details, arrange a viewing, reply).\nReply with JSON only: {"labels":["...","...","..."]}`;
  const user = [`Language: ${LANGS[language]}.`, factsBlock(property), body.instruction ? `Context: ${body.instruction}` : ''].filter(Boolean).join('\n\n');
  const parsed = await model(sb, 'cta', system, user, 300) as Record<string, unknown>;
  const list = (Array.isArray(parsed.labels) ? parsed.labels : []).map((s) => String(s).trim().slice(0, 40)).filter(Boolean).slice(0, 3);
  if (!list.length) throw new Error('empty');
  return json({ ok: true, labels: list });
}

async function composeMessage(sb: Sb, body: StudioRequest, property: PropertyContext | null, language: string, instruction: string): Promise<Response> {
  const channel: MessageChannel = (Object.keys(CHANNEL_LIMIT) as MessageChannel[]).includes(body.channel as MessageChannel) ? body.channel as MessageChannel : 'PROFILE_DM';
  const max = CHANNEL_LIMIT[channel];
  const lang = LANGS[String(body.recipientLanguage)] ? String(body.recipientLanguage) : language;
  const system = `${RULES}\nYou write a short private message (${channel}). Plain text only, no HTML, no markdown. At most ${max} characters. ` +
    'Open politely, say why you are writing (they showed interest in a similar property publicly), give the two or three most relevant facts, and invite a reply. ' +
    'Address the person with {{first_name|}} only if a greeting needs a name.\nReply with JSON only: {"text":"..."}';
  const user = [`Language: ${LANGS[lang]}.`, factsBlock(property), `The owner's request:\n"""\n${instruction || 'A friendly first message about this property.'}\n"""`].join('\n\n');
  const parsed = await model(sb, 'compose_message', system, user, 600) as Record<string, unknown>;
  const text = String(parsed.text ?? '').replace(/<[^>]+>/g, '').trim().slice(0, max);
  if (!text) throw new Error('empty');
  return json({ ok: true, text, limit: max });
}

async function personalize(sb: Sb, body: StudioRequest, language: string): Promise<Response> {
  const text = String(body.text ?? '').slice(0, 3000);
  if (!text.trim()) return json({ ok: false, code: 'BAD_REQUEST' }, 400);
  const name = String(body.recipientName ?? '').trim().slice(0, 80);
  const lang = LANGS[String(body.recipientLanguage)] ? String(body.recipientLanguage) : language;
  const system = `${RULES}\nYou personalise a message for one recipient using ONLY their name and language. Do not add any other claim about them. Keep the facts unchanged.\nReply with JSON only: {"text":"..."}`;
  const user = `Recipient name: ${name || '(unknown — do not use a name)'}\nWrite in: ${LANGS[lang]}\n\nMessage:\n"""\n${text}\n"""`;
  const parsed = await model(sb, 'personalize', system, user, 700) as Record<string, unknown>;
  const out = String(parsed.text ?? '').replace(/<(?!\/?(b|i|br)\b)[^>]+>/gi, '').trim().slice(0, 3000);
  if (!out) throw new Error('empty');
  return json({ ok: true, text: out });
}
