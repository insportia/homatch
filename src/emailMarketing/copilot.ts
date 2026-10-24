// HOMI — the Email Studio copilot: the prompt and the guard around what a model returns.
// Owner brief §6.
//
// HOMI PROPOSES, THE USER DISPOSES. A model answer is never applied by the server. It is parsed
// into a bounded proposal — subject ideas, a preview line, text edits addressed to existing block
// ids, or a draft as designer blocks — validated here, and returned for the user to accept or
// reject in the UI (significant edits always ask first).
//
// WHAT HOMI MAY NOT DO
//   · invent facts: a figure (price, size, percentage, date, count) that appears in a suggestion
//     but nowhere in the campaign, the instruction or the facts the user gave is flagged
//     UNVERIFIED_FIGURE and the UI shows it before anything is applied;
//   · bypass compliance: every proposal runs through the Campaign Risk Engine's static layer; a
//     hard finding (gambling promotion, phishing, unsafe link…) drops the proposal entirely;
//   · claim consent, guarantee returns, or address a recipient by anything but merge fields.

import { type Block, type LeafBlock, normalizeDoc } from './designer/document.ts';
import { richToText } from './designer/richText.ts';
import { TEMPLATE_KINDS, type TemplateKind } from './designer/templates.ts';
import { assessCampaign, type Finding } from './risk/engine.ts';

export const COPILOT_TASKS = ['ideas', 'subjects', 'preview', 'draft', 'rewrite', 'shorten', 'professional', 'translate', 'cta', 'review', 'audience', 'help', 'template'] as const;
export type CopilotTask = (typeof COPILOT_TASKS)[number];

export const LANG_NAMES: Record<string, string> = { ka: 'Georgian', en: 'English', ru: 'Russian', tr: 'Turkish', ar: 'Arabic', he: 'Hebrew' };

export interface CopilotRequest {
  task: CopilotTask;
  instruction: string;
  language: string;
  targetLanguage?: string | null;
  campaign: { name?: string; objective?: string; subject?: string; preview_text?: string; audience?: string };
  /** Text-bearing blocks of the current design (id, type, text/label/href). */
  blocks: Array<{ id: string; type: string; text?: string; label?: string; href?: string }>;
  /** Facts the user stated for HOMI to use (never invented). */
  facts?: string;
  /** Risk findings to explain (task "review"). */
  findings?: Array<{ code: string; severity: string; detail?: string }>;
}

export interface CopilotProposal {
  message: string;
  subjects?: string[];
  preview?: string;
  edits?: Array<{ id: string; field: 'text' | 'label'; value: string }>;
  blocks?: Block[];
  ideas?: Array<{ name: string; objective: string }>;
  /** Task "template": the built-in template HOMI recommends (one of TEMPLATE_KINDS). */
  template?: TemplateKind;
  warnings: Finding[];
}

export const COPILOT_SYSTEM_PROMPT = `You are HOMI, the email-marketing copilot inside HOMATCH, a real-estate platform in Georgia.
You help a customer write ONE email campaign. Answer ONLY with a JSON object, no prose outside it:
{"message": string, "subjects"?: string[], "preview"?: string, "edits"?: [{"id": string, "field": "text"|"label", "value": string}],
 "blocks"?: [{"type": "heading"|"text"|"button", "text"?: string, "label"?: string}], "ideas"?: [{"name": string, "objective": string}],
 "template"?: string}

Rules you never break:
- Use ONLY facts present in the request (campaign, blocks, facts, instruction). Never invent prices, sizes, dates,
  discounts, percentages, returns, availability, awards, statistics or quotes. If a fact is missing, write a clear
  [placeholder in square brackets] instead.
- Never claim the recipient consented, subscribed or asked for this email. Never promise guaranteed returns or "no risk".
- No gambling, betting, casino, crypto-trading, adult, political or deceptive content; no urgency tricks; no ALL CAPS.
- Address the reader with the merge field {{first_name|fallback}} only — never a made-up name.
- "message" is a short explanation to the customer in the UI language given as "uiLanguage".
- Write email copy in "language" (or "targetLanguage" when translating). Keep Georgian natural and correct
  (match = დამთხვევა, tenant = მოიჯარე, Tbilisi = თბილისი).
- "edits" may only target the block ids you were given, and only their text (text/heading) or label (button).
- Keep links as they are; never add or change URLs.
Task meanings: ideas = 3 campaign names with objectives; subjects = 3 subject lines (≤ 70 chars); preview = one preview line
(≤ 110 chars); draft = a complete email as blocks (heading, 2–4 text blocks, one button label); rewrite/professional/shorten =
edits of existing blocks; translate = edits with every text in targetLanguage plus translated subjects[0] and preview;
cta = edits of button labels (≤ 30 chars) and the sentence before it; review = explain the given risk findings and how to
fix each, in plain words (message only); audience = suggest which audience segments fit the objective (message only);
help = answer the customer's question (instruction) about the screen they are on, using ONLY the context in "facts" (the step,
real counts, limits and errors the product measured): short, plain words, ≤ 120 words, never a number that is not in facts,
never legal advice; message only. template = recommend ONE template from the list in facts for the objective, set "template"
to its code exactly, and say why in one sentence.`;

export function buildUserPayload(r: CopilotRequest, uiLanguage: string): string {
  return JSON.stringify({
    task: r.task, instruction: r.instruction.slice(0, 1500), uiLanguage: LANG_NAMES[uiLanguage] ?? 'English',
    language: LANG_NAMES[r.language] ?? 'English', targetLanguage: r.targetLanguage ? LANG_NAMES[r.targetLanguage] ?? null : null,
    campaign: r.campaign, facts: (r.facts ?? '').slice(0, 3000), findings: (r.findings ?? []).slice(0, 30),
    blocks: r.blocks.slice(0, 40).map((b) => ({ id: b.id, type: b.type, text: b.text?.slice(0, 2000), label: b.label, href: b.href })),
  });
}

/** Text-bearing blocks of a design, for the request (columns flattened). */
export function textBlocksOf(design: unknown): CopilotRequest['blocks'] {
  const doc = normalizeDoc(design);
  const out: CopilotRequest['blocks'] = [];
  const leaf = (b: LeafBlock) => {
    if (b.type === 'heading' || b.type === 'text') out.push({ id: b.id, type: b.type, text: b.rich ? richToText(b.rich) : b.text });
    else if (b.type === 'footer') out.push({ id: b.id, type: b.type, text: b.text });
    else if (b.type === 'button') out.push({ id: b.id, type: b.type, label: b.label, href: b.href });
  };
  for (const b of doc.blocks) {
    if (b.type === 'columns') { b.columns[0].forEach(leaf); b.columns[1].forEach(leaf); } else leaf(b);
  }
  return out;
}

const FIGURE = /(?:\d[\d\s.,]*\d|\d)\s*(?:%|\$|€|₾|gel|usd|eur|m²|m2|sqm|კვ|кв)?/gi;
function figures(text: string): string[] {
  return [...String(text).matchAll(FIGURE)].map((m) => m[0].replace(/\s+/g, '').replace(/[.,]$/, '').toLowerCase()).filter((f) => /\d/.test(f));
}

const s = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : '');

/** A model's raw JSON → a safe proposal, or null when nothing usable (or something prohibited) came back. */
export function parseProposal(raw: unknown, r: CopilotRequest): CopilotProposal | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const ids = new Map(r.blocks.map((b) => [b.id, b.type]));
  const p: CopilotProposal = { message: s(o.message, 2000), warnings: [] };
  if (Array.isArray(o.subjects)) p.subjects = o.subjects.map((x) => s(x, 120)).filter(Boolean).slice(0, 5);
  if (typeof o.preview === 'string') p.preview = s(o.preview, 160) || undefined;
  if (typeof o.template === 'string' && (TEMPLATE_KINDS as string[]).includes(o.template.trim().toUpperCase())) p.template = o.template.trim().toUpperCase() as TemplateKind;
  if (Array.isArray(o.ideas)) p.ideas = o.ideas.slice(0, 5).map((i) => (i && typeof i === 'object' ? i as Record<string, unknown> : {}))
    .map((i) => ({ name: s(i.name, 120), objective: s(i.objective, 300) })).filter((i) => i.name);
  if (Array.isArray(o.edits)) {
    p.edits = o.edits.map((e) => (e && typeof e === 'object' ? e as Record<string, unknown> : {}))
      .map((e) => ({ id: s(e.id, 40), field: (e.field === 'label' ? 'label' : 'text') as 'text' | 'label', value: s(e.value, 5000) }))
      .filter((e) => e.value && ids.has(e.id) && (e.field === 'label' ? ids.get(e.id) === 'button' : ids.get(e.id) !== 'button'))
      .map((e) => (e.field === 'label' ? { ...e, value: e.value.slice(0, 80) } : e))
      .slice(0, 40);
  }
  if (Array.isArray(o.blocks)) {
    const doc = normalizeDoc({ blocks: o.blocks.slice(0, 12).map((b) => {
      const x = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
      if (x.type === 'button') return { type: 'button', label: s(x.label, 80), href: '', align: 'left' };
      if (x.type === 'heading') return { type: 'heading', text: s(x.text, 300), level: 1, align: 'left' };
      return { type: 'text', text: s(x.text, 5000), align: 'left' };
    }) });
    p.blocks = doc.blocks.filter((b) => (b.type === 'button' ? b.label : 'text' in b ? (b as { text: string }).text : true));
  }
  const proposed = [
    ...(p.subjects ?? []), p.preview ?? '', ...(p.edits ?? []).map((e) => e.value),
    ...(p.blocks ?? []).map((b) => (b.type === 'button' ? b.label : 'text' in b ? (b as { text: string }).text : '')),
    ...(p.ideas ?? []).flatMap((i) => [i.name, i.objective]),
  ].join('\n');
  if (!proposed.trim() && !p.message && !p.template) return null;

  /* Compliance: a proposal that would itself be blocked is never offered. */
  const risk = assessCampaign({ subject: (p.subjects ?? [])[0] ?? 'x', html: `<p>${proposed.replace(/[<>]/g, ' ')}</p>`, senderVerified: true });
  const hard = risk.findings.filter((f) => f.severity === 'BLOCK');
  if (hard.length) return { message: '', warnings: hard };
  for (const f of risk.findings) if (['MISLEADING_FINANCIAL_CLAIM', 'SPAM_PRESSURE', 'GAMBLING_MENTION', 'IMPERSONATION_AUTHORITY'].includes(f.code)) p.warnings.push(f);

  /* Figures that are not in what the user gave are flagged, never silently accepted. */
  const known = new Set(figures([r.instruction, r.facts ?? '', JSON.stringify(r.campaign), ...r.blocks.map((b) => `${b.text ?? ''} ${b.label ?? ''}`)].join('\n')));
  const unknown = [...new Set(figures(proposed))].filter((f) => !known.has(f) && !/^[1-5]$/.test(f));
  if (unknown.length) p.warnings.push({ code: 'UNVERIFIED_FIGURE', severity: 'HIGH', detail: unknown.slice(0, 6).join(', ') });
  return p;
}
