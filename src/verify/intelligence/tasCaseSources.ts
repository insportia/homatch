/*
 * TAS CASE SOURCES — one reader for every place a TAS case keeps its words.
 *
 * The official worker hands a case over in several layers, and they grew at
 * different times:
 *
 *   tasApi.cases[].values        label/value pairs from the case form. Older
 *                                runs: {key,label,value,group}; the extended
 *                                worker: {label,value,path}.
 *   tasApi.cases[].form.fields   the same form, as the page lays it out
 *                                (array of {label,value,path} or a label→value
 *                                object).
 *   tasApi.cases[].attachments[] the files; for the two newest cases
 *                                (`priority: 1|2`) the extended worker adds
 *                                their full `text` and `textComplete`.
 *   tasApi.cases[].motions[]     steps; decision evidence windows, and on the
 *                                extended worker their response text.
 *   browserOfficial.results[].documents[]  one bounded text per case
 *                                (`tasDocumentId`, `rawText`).
 *
 * Extractors (tasProfessionals.ts, technicalSpecs.ts, officialDocuments) read
 * THIS shape so each of them does not re-learn the worker's history. Pure,
 * deterministic, no I/O. Personal ID numbers, phones and e-mails are removed
 * from every text at the door.
 */

export const TAS_PUBLIC_ORIGIN = 'https://docs.tbilisi.gov.ge';
export const tasPublicUrl = (documentId: string | null): string | null =>
  documentId ? `${TAS_PUBLIC_ORIGIN}/architect/public.html?docId=${encodeURIComponent(documentId)}` : null;
export const tasAttachmentUrl = (attachedFileId: string | null): string | null =>
  attachedFileId ? `${TAS_PUBLIC_ORIGIN}/DownloadServlet?downloadCase=2&attachedFileId=${encodeURIComponent(attachedFileId)}` : null;

export interface CaseField {
  label: string;
  value: string;
  /** Section path of the form ("ექსპერტიზა > … > სპეციალისტი"), when given. */
  path: string | null;
}

export interface CaseText {
  text: string;
  kind: 'CASE' | 'ATTACHMENT' | 'MOTION' | 'DECISION';
  documentTitle: string | null;
  fileName: string | null;
  sourceUrl: string | null;
  date: string | null;
  complete: boolean;
}

export interface CaseAttachment {
  attachedFileId: string | null;
  fileName: string | null;
  format: string | null;
  outcome: string | null;
  pages: number | null;
  date: string | null;
  motionId: string | null;
  hasText: boolean;
  textComplete: boolean;
}

export interface CaseMotion {
  date: string | null;
  name: string | null;
  status: string | null;
  decisionNumber: string | null;
  decision: { outcome: string; number: string | null; evidence: string | null; issueDate: string | null; validUntil: string | null } | null;
}

export interface CaseSource {
  documentId: string | null;
  caseRef: string | null;
  date: string | null;
  title: string | null;
  docType: string | null;
  description: string | null;
  status: string | null;
  /** 1 = the newest case, 2 = the one before it (extended worker), else null. */
  priority: 1 | 2 | null;
  /** Review deadline, when the case states one. */
  deadline: string | null;
  publicUrl: string | null;
  parties: Array<{ role: string; name: string; kind: string; organizationId: string | null }>;
  fields: CaseField[];
  texts: CaseText[];
  attachments: CaseAttachment[];
  motions: CaseMotion[];
}

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v.replace(/[ \t ]+/g, ' ').trim() : typeof v === 'number' ? String(v) : '');

/** ISO day from an ISO stamp or a d.m.Y / d/m/Y date; null otherwise. */
export function isoDay(v: unknown): string | null {
  const t = typeof v === 'string' ? v : typeof v === 'number' && v > 1e11 ? new Date(v).toISOString() : '';
  if (!t) return null;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(t);
  if (iso) return iso[1];
  const g = /(\d{1,2})[./](\d{1,2})[./](\d{4})/.exec(t);
  if (g && +g[2] >= 1 && +g[2] <= 12 && +g[1] >= 1 && +g[1] <= 31) return `${g[3]}-${g[2].padStart(2, '0')}-${g[1].padStart(2, '0')}`;
  return null;
}

/** Personal numbers, phones and e-mails never leave this module. */
export function redactPersonal(text: string): string {
  return String(text ?? '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, ' ')
    .replace(/(?:პ\/ნ|პ\.ნ\.?|p\/n|პირადი\s+(?:ნომერი|№))\s*:?\s*\d{11}/giu, ' ')
    .replace(/(?<!\d)\d{11}(?!\d)/g, ' ')
    .replace(/(?:ტელ(?:ეფონი)?\.?|tel\.?|phone|მობ\.?)\s*:?\s*\+?[\d\s()-]{7,18}\d/giu, ' ')
    .replace(/\+995[\s-]?\d{3}[\s-]?\d{2,3}[\s-]?\d{2,3}[\s-]?\d{0,3}/g, ' ')
    .replace(/(?<!\d)5\d{2}[\s-]\d{2}[\s-]\d{2}[\s-]\d{2}(?!\d)/g, ' ');
}

function fieldsOf(c: Record<string, any>): CaseField[] {
  const out: CaseField[] = [];
  const seen = new Set<string>();
  const push = (label: unknown, value: unknown, path: unknown) => {
    const l = str(label);
    const v = redactPersonal(str(value)).replace(/\s+/g, ' ').trim();
    if (!l || !v) return;
    const k = `${l}|${v}|${str(path)}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ label: l, value: v, path: str(path) || null });
  };
  for (const v of arr<any>(c.values)) push(v?.label ?? v?.key, v?.value, v?.path ?? v?.group);
  const form = obj(c.form);
  const ff = form.fields;
  if (Array.isArray(ff)) for (const f of ff) push(f?.label ?? f?.name ?? f?.key, f?.value ?? f?.text, f?.path ?? f?.section);
  else for (const [k, v] of Object.entries(obj(ff))) push(k, typeof v === 'object' ? obj(v).value : v, typeof v === 'object' ? obj(v).path : null);
  return out;
}

function priorityOf(v: unknown): 1 | 2 | null {
  const n = Number(v);
  return n === 1 || n === 2 ? n : null;
}

/**
 * Every TAS case of the report, with its fields, texts, attachments and
 * motions in one shape. Newest first by case date.
 */
export function readCaseSources(report: unknown): CaseSource[] {
  const results = arr<any>(obj(obj(report).browserOfficial).results).filter((r) => str(r?.source).toLowerCase() === 'tas');
  const api = results.find((r) => r?.tasApi)?.tasApi ?? null;
  const docTexts = new Map<string, { text: string; title: string | null; url: string | null; date: string | null; complete: boolean }>();
  for (const r of results)
    for (const d of arr<any>(r?.documents)) {
      const id = str(d?.tasDocumentId) || str(d?.id).replace(/^tas_/, '');
      const text = typeof d?.fullText === 'string' && d.fullText ? d.fullText : typeof d?.rawText === 'string' ? d.rawText : '';
      if (id && text) docTexts.set(id, { text, title: str(d?.title) || null, url: str(d?.url) || null, date: isoDay(d?.documentDate ?? d?.date), complete: d?.textTruncated !== true });
    }
  const out: CaseSource[] = [];
  for (const c of arr<any>(api?.cases)) {
    const documentId = str(c?.documentId) || null;
    const caseRef = str(c?.registrationNumber) || null;
    const date = isoDay(c?.date);
    const publicUrl = tasPublicUrl(documentId);
    const texts: CaseText[] = [];
    const dt = documentId ? docTexts.get(documentId) : undefined;
    if (dt) texts.push({ text: redactPersonal(dt.text), kind: 'CASE', documentTitle: dt.title ?? (str(c?.title) || null), fileName: null, sourceUrl: publicUrl ?? dt.url, date: date ?? dt.date, complete: dt.complete });
    for (const key of ['fullText', 'text'] as const)
      if (typeof c?.[key] === 'string' && c[key].trim() && !dt) {
        texts.push({ text: redactPersonal(c[key]), kind: 'CASE', documentTitle: str(c?.title) || null, fileName: null, sourceUrl: publicUrl, date, complete: c?.textTruncated !== true });
        break;
      }
    const attachments: CaseAttachment[] = [];
    for (const a of arr<any>(c?.attachments)) {
      const fileName = str(a?.fileName) || null;
      const attachedFileId = str(a?.attachedFileId) || null;
      const t = typeof a?.text === 'string' ? a.text : '';
      attachments.push({
        attachedFileId, fileName,
        format: (str(a?.format) || str(a?.extension) || (fileName && /\.([a-z0-9]{2,5})$/i.exec(fileName)?.[1]) || '').toLowerCase() || null,
        outcome: str(a?.outcome) || null,
        pages: Number(a?.pages) > 0 ? Number(a.pages) : null,
        date: isoDay(a?.date),
        motionId: str(a?.motionId) || null,
        hasText: !!t.trim(),
        textComplete: a?.textComplete === true,
      });
      if (t.trim()) texts.push({ text: redactPersonal(t), kind: 'ATTACHMENT', documentTitle: str(a?.description) || fileName, fileName, sourceUrl: tasAttachmentUrl(attachedFileId), date: isoDay(a?.date) ?? date, complete: a?.textComplete === true });
    }
    const motions: CaseMotion[] = [];
    for (const m of arr<any>(c?.motions)) {
      const d = obj(m?.decision);
      motions.push({
        date: isoDay(m?.date), name: str(m?.name) || null, status: str(m?.status) || null, decisionNumber: str(m?.decisionNumber) || null,
        decision: d.outcome ? { outcome: str(d.outcome), number: str(d.number) || null, evidence: str(d.evidence) || null, issueDate: isoDay(d.issueDate), validUntil: isoDay(d.validUntil) } : null,
      });
      const mt = typeof m?.responseText === 'string' ? m.responseText : typeof m?.text === 'string' ? m.text : '';
      if (mt.trim()) texts.push({ text: redactPersonal(mt), kind: 'MOTION', documentTitle: str(m?.name) || null, fileName: null, sourceUrl: publicUrl, date: isoDay(m?.date) ?? date, complete: true });
    }
    const fields = fieldsOf(c);
    const deadlineField = fields.find((f) => /განხილვის\s+ვად|პასუხის\s+ვად|review\s+deadline|^ვადა$|deadline/i.test(f.label));
    out.push({
      documentId, caseRef, date,
      title: str(c?.title) || null,
      docType: str(c?.docType) || null,
      description: str(c?.description) || null,
      status: str(c?.status) || null,
      priority: priorityOf(c?.priority),
      deadline: isoDay(c?.deadline ?? c?.dueDate ?? c?.reviewDeadline) ?? (deadlineField ? isoDay(deadlineField.value) : null),
      publicUrl,
      parties: arr<any>(c?.parties).map((p) => ({ role: str(p?.role), name: str(p?.name), kind: str(p?.kind) || 'UNKNOWN', organizationId: str(p?.organizationId) || null })).filter((p) => p.name),
      fields, texts, attachments, motions,
    });
  }
  out.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  // Older runs carry no priority: the two newest cases are the priority ones.
  if (!out.some((c) => c.priority)) out.slice(0, 2).forEach((c, i) => { c.priority = (i + 1) as 1 | 2; });
  return out;
}

/** Positive, final decisions with legal effect. */
export const APPROVING_OUTCOMES = new Set(['PERMIT_ISSUED', 'APPROVED', 'AMENDMENT_APPROVED', 'DEADLINE_EXTENDED', 'COMMISSIONED']);
export const FINAL_OUTCOMES = new Set([...APPROVING_OUTCOMES, 'REFUSED', 'SUSPENDED', 'CANCELLED']);
const CLOSED_STATUS = /დასრულ|დახურ|უარ|შეწყვეტ|გაუქმ|შეჩერ|დაკმაყოფილ|გაცემულ|closed|complet|refus|cancel|reject|granted|issued/i;
const UNDER_REVIEW_STATUS = /განხილვ|პროცესში|მიმდინარე|წარმოებაშ|შესწავლ|under\s+review|in\s+review|pending|processing|in\s+progress/i;

/**
 * Where a case stands on its own record. A future-dated decision is not a
 * decision (see `now`): a reference dated after the job's own completion is
 * a cited date, never an issued act.
 */
export function caseDecisionState(c: CaseSource, nowDay: string | null): 'APPROVED' | 'NEGATIVE' | 'UNDER_REVIEW' | 'UNDECIDED' {
  const decided = c.motions.filter((m) => m.decision && FINAL_OUTCOMES.has(m.decision.outcome) && !(nowDay && (m.decision.issueDate ?? m.date ?? '') > nowDay));
  if (decided.length) {
    const last = decided.sort((a, b) => (a.decision!.issueDate ?? a.date ?? '').localeCompare(b.decision!.issueDate ?? b.date ?? ''))[decided.length - 1];
    return APPROVING_OUTCOMES.has(last.decision!.outcome) ? 'APPROVED' : 'NEGATIVE';
  }
  const status = c.status ?? '';
  if (UNDER_REVIEW_STATUS.test(status) && !CLOSED_STATUS.test(status)) return 'UNDER_REVIEW';
  return 'UNDECIDED';
}

export function caseIsClosed(c: CaseSource): boolean {
  return CLOSED_STATUS.test(c.status ?? '') && !UNDER_REVIEW_STATUS.test(c.status ?? '');
}

/** The subject of a case in its own words: type, title or description. */
export function caseSubject(c: CaseSource): string | null {
  const parts = [c.docType, c.title, c.description].filter((p): p is string => !!p && p.length > 2);
  const uniq: string[] = [];
  for (const p of parts) if (!uniq.some((u) => u.includes(p) || p.includes(u))) uniq.push(p);
  const s = uniq.join(' · ');
  return s ? (s.length > 300 ? `${s.slice(0, 297)}…` : s) : null;
}
