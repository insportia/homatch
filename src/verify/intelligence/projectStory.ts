/*
 * THE PROJECT'S STORY, AS EVENTS A BUYER CAN FOLLOW.
 *
 * The official record of a Tbilisi project is dozens of administrative
 * steps: approvals, deficiency notices, permits re-issued for corrected
 * projects, applications whose answer nobody read. Listed, they are a
 * register. This module turns them into a short sequence of events, each
 * answering what happened, when, what changed and why it matters, with a
 * stage badge (proposed / approved / implemented / documented). Case and
 * decision numbers travel as evidence underneath, never in the sentence.
 *
 * THREE TRACKS, NEVER MERGED.
 *   CONSTRUCTION   works on site: an audit finding about the works, photos
 *                  filed with an application, the developer's own statement
 *                  (labelled as such). Construction is never "not started"
 *                  because a start date is missing, and never "completed"
 *                  because photos look finished.
 *   PERMIT         what the city allowed, and until when.
 *   COMMISSIONING  ექსპლუატაციაში მიღება: only an act of the city settles it.
 *                  Nothing else on this page may imply it.
 *
 * Duplicate administrative steps are grouped: consecutive approvals within
 * two years are one event; permits superseded by a later one are one event,
 * and the permit in force stands alone.
 *
 * Inputs are the persisted synthesis (officialHistory) and ProjectSignals,
 * which verify-synthesis extracts from the raw result with
 * extractProjectSignals(). Pure and deterministic. Prose is Georgian, like
 * the rest of the report body; UI chrome is translated by the component.
 */

import { readCaseSources } from './tasCaseSources.ts';
import { kaOnDay, kaInMonth, kaOfMonth, kaOfDay, yearOf } from './kaDates.ts';
import { stripProvenanceOpening, replaceDashes } from './editorial.ts';

/* ───────────────────────── Signals from the raw result ───────────────────────── */

export interface AuditFinding {
  caseRef: string | null;
  decisionNumber: string | null;
  date: string | null;
  /** The city also asked for the inspection's ruling and proof the fine was paid. */
  fineRequested: boolean;
}
export interface ProjectSignals {
  auditFinding: AuditFinding | null;
  /** Cases whose files include photographs of the site, newest first. */
  photoCases: Array<{ caseRef: string | null; date: string | null }>;
  /** The project's public description of works (never an official fact). */
  developerStatus: { text: string; date: string | null } | null;
  developerStart: string | null;
}

const AUDIT = /შიდა\s+აუდიტ\S*\s+და\s+მონიტორინგ/u;
const DEVIATION = /მშენებლობა\s+(?:ნაწარმოებია|მიმდინარეობს|განხორციელდა|ხორციელდება)\s+შეთანხმებული\s+პროექტის\s+(?:დარღვევით|გადახვევით)|შეთანხმებული\s+პროექტისგან\s+(?:განსხვავებით|გადახვევით)/u;
const FINE = /ჯარიმ/u;
const PHOTO_FILE = /ფოტო|photo|фото/iu;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const day = (v: unknown): string | null => {
  const m = typeof v === 'string' ? /^(\d{4}-\d{2}-\d{2})/.exec(v) : null;
  return m ? m[1] : null;
};

/** What the raw research result says about the works themselves. */
export function extractProjectSignals(result: unknown): ProjectSignals {
  const cases = readCaseSources(result);
  let auditFinding: AuditFinding | null = null;
  for (const c of cases) {
    for (const t of c.texts) {
      const text = t.text.replace(/[ \t]+/g, ' ');
      const flat = text.replace(/\s+/g, ' ');
      const a = AUDIT.exec(flat);
      if (!a || !DEVIATION.test(flat)) continue;
      // The decision this paragraph belongs to: the nearest heading before it.
      const before = flat.slice(0, a.index);
      const nums = [...before.matchAll(/(?:DECISION\s+\w+\s+N|გადაწყვეტილება\s+No)\s*(\d{6,8})/gu)];
      const dates = [...before.matchAll(/\[(\d{4}-\d{2}-\d{2})\s*·\s*motion/gu)];
      const found: AuditFinding = {
        caseRef: c.caseRef,
        decisionNumber: nums.length ? nums[nums.length - 1][1] : null,
        date: dates.length ? dates[dates.length - 1][1] : t.date ?? c.date,
        fineRequested: FINE.test(flat.slice(a.index, a.index + 1200)),
      };
      if (!auditFinding || (found.date ?? '') > (auditFinding.date ?? '')) auditFinding = found;
    }
  }
  const photoCases = cases
    .filter((c) => c.attachments.some((a) => PHOTO_FILE.test(a.fileName ?? '')))
    .map((c) => ({ caseRef: c.caseRef, date: c.date }))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  const r = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
  const pr = r.publicResearch && typeof r.publicResearch === 'object' ? (r.publicResearch as Record<string, unknown>) : {};
  const status = str(pr.currentPhysicalStatus);
  const statusDate = /(\d{4})\s+წლის\s+(\d{1,2})\s+(\S+?)(?:ით|ს|ის)?\s/u.exec(status);
  return {
    auditFinding,
    photoCases,
    developerStatus: status ? { text: status, date: statusDate ? kaMonthToIso(statusDate[1], statusDate[2], statusDate[3]) : null } : null,
    developerStart: str(pr.constructionStart) || null,
  };
}

const MONTH_STEM = ['იანვ', 'თებერვ', 'მარტ', 'აპრილ', 'მაის', 'ივნის', 'ივლის', 'აგვისტ', 'სექტემბ', 'ოქტომბ', 'ნოემბ', 'დეკემბ'];
function kaMonthToIso(y: string, d: string, month: string): string | null {
  const i = MONTH_STEM.findIndex((s) => month.startsWith(s));
  return i < 0 ? null : `${y}-${String(i + 1).padStart(2, '0')}-${d.padStart(2, '0')}`;
}

export function readProjectSignals(v: unknown): ProjectSignals | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const a = o.auditFinding && typeof o.auditFinding === 'object' ? (o.auditFinding as Record<string, unknown>) : null;
  const ds = o.developerStatus && typeof o.developerStatus === 'object' ? (o.developerStatus as Record<string, unknown>) : null;
  return {
    auditFinding: a ? { caseRef: str(a.caseRef) || null, decisionNumber: str(a.decisionNumber) || null, date: day(a.date), fineRequested: a.fineRequested === true } : null,
    photoCases: Array.isArray(o.photoCases) ? (o.photoCases as Array<Record<string, unknown>>).map((p) => ({ caseRef: str(p?.caseRef) || null, date: day(p?.date) })) : [],
    developerStatus: ds && str(ds.text) ? { text: str(ds.text), date: day(ds.date) } : null,
    developerStart: str(o.developerStart) || null,
  };
}

/* ───────────────────────── The story ───────────────────────── */

export type StoryStage = 'PROPOSED' | 'APPROVED' | 'IMPLEMENTED' | 'DOCUMENTED';
export type StoryTrack = 'CONSTRUCTION' | 'PERMIT' | 'COMMISSIONING';

export interface StoryEvidence { caseRef: string | null; decisionNumber: string | null; date: string | null }
export interface StoryEvent {
  id: string;
  track: StoryTrack;
  stage: StoryStage;
  date: string | null;
  endDate: string | null;
  /** How many administrative records this event stands for. */
  count: number;
  /** The developer's own statement rather than an official record. */
  developerClaim: boolean;
  what: string;
  changed: string | null;
  why: string;
  evidence: StoryEvidence[];
}
export interface TrackSummary {
  track: StoryTrack;
  state: 'STARTED_DOCUMENTED' | 'NOT_DOCUMENTED' | 'PERMIT_IN_FORCE' | 'PERMIT_UNKNOWN' | 'COMMISSIONED' | 'NO_ACT_SEEN';
  text: string;
}
export interface ProjectStoryView {
  tracks: TrackSummary[];
  events: StoryEvent[];
}

interface Decision { number: string | null; date: string | null; outcome: string | null; effect: string | null; term: { from: string | null; until: string | null } | null }
interface CaseRow {
  caseRef: string | null;
  filedOn: string | null;
  stage: string;
  effect: string | null;
  decisions: Decision[];
  unreadResponses: Array<{ number: string | null; publishedOn: string | null }>;
  supersedesPermit: { caseRef: string | null; decisionNumber: string | null; date: string | null } | null;
  metrics: Array<{ label: string; value: string }>;
}

function readCases(history: Record<string, unknown>): CaseRow[] {
  const raw = Array.isArray(history.caseChronology) ? (history.caseChronology as Array<Record<string, unknown>>) : [];
  return raw.map((c) => ({
    caseRef: str(c?.caseRef) || null,
    filedOn: day(c?.filedOn),
    stage: str(c?.stage).toUpperCase(),
    effect: str(c?.effect) || null,
    decisions: (Array.isArray(c?.decisions) ? (c.decisions as Array<Record<string, unknown>>) : []).map((d) => {
      const term = d?.term && typeof d.term === 'object' ? (d.term as Record<string, unknown>) : null;
      return { number: str(d?.number) || null, date: day(d?.date ?? d?.publishedOn), outcome: str(d?.outcome) || null, effect: str(d?.effect) || null, term: term ? { from: day(term.from), until: day(term.until) } : null };
    }),
    unreadResponses: (Array.isArray(c?.unreadResponses) ? (c.unreadResponses as Array<Record<string, unknown>>) : []).map((u) => ({ number: str(u?.number) || null, publishedOn: day(u?.publishedOn) })),
    supersedesPermit: c?.supersedesPermit && typeof c.supersedesPermit === 'object'
      ? { caseRef: str((c.supersedesPermit as Record<string, unknown>).caseRef) || null, decisionNumber: str((c.supersedesPermit as Record<string, unknown>).decisionNumber) || null, date: day((c.supersedesPermit as Record<string, unknown>).date) }
      : null,
    metrics: (Array.isArray(c?.metrics) ? (c.metrics as Array<Record<string, unknown>>) : []).map((m) => ({ label: str(m?.label), value: str(m?.value) })).filter((m) => m.label && m.value),
  })).sort((a, b) => (a.filedOn ?? '').localeCompare(b.filedOn ?? ''));
}

/* Milestones only — older reports without caseChronology. */
function casesFromMilestones(history: Record<string, unknown>): CaseRow[] {
  const ms = Array.isArray(history.milestones) ? (history.milestones as Array<Record<string, unknown>>) : [];
  return ms
    .filter((m) => ['APPROVED', 'PERMIT_ISSUED'].includes(str(m?.outcome).toUpperCase()))
    .map((m) => {
      const outcome = str(m.outcome).toUpperCase();
      return {
        caseRef: str(m.caseRef) || null, filedOn: day(m.date), stage: 'DECIDED',
        effect: outcome === 'PERMIT_ISSUED' ? 'PERMIT' : 'PROJECT_APPROVED',
        decisions: [{ number: str(m.decisionNumber) || null, date: day(m.date), outcome, effect: outcome === 'PERMIT_ISSUED' ? 'PERMIT' : 'PROJECT_APPROVED', term: null }],
        unreadResponses: [], supersedesPermit: null, metrics: [],
      };
    })
    .sort((a, b) => (a.filedOn ?? '').localeCompare(b.filedOn ?? ''));
}

const monthsBetween = (a: string | null, b: string | null): number => {
  if (!a || !b) return Infinity;
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7)));
};
const isPermit = (d: Decision) => d.outcome === 'PERMIT_ISSUED' || /PERMIT/.test(d.effect ?? '');
const isApproval = (d: Decision) => !isPermit(d) && (d.outcome === 'APPROVED' || d.outcome === 'AMENDMENT_APPROVED' || /APPROVED/.test(d.effect ?? ''));
const k2Of = (c: CaseRow): number | null => {
  const m = c.metrics.find((x) => /K\s*-?\s*2|კ\s*-?\s*2/iu.test(x.label));
  const n = m ? Number(m.value.replace(',', '.')) : NaN;
  return Number.isFinite(n) ? n : null;
};
const fmt = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const yearsPhrase = (a: string | null, b: string | null): string => {
  const ya = yearOf(a), yb = yearOf(b);
  if (!ya) return '';
  return !yb || ya === yb ? `${ya} წელს` : `${ya}-დან ${yb} წლამდე`;
};

export interface StoryInput {
  history: unknown;
  signals?: unknown;
  /** Approved technical specs, to say whether a pending application changes the main figures. */
  specs?: unknown;
}

export function projectStory(input: StoryInput): ProjectStoryView | null {
  const history = input.history && typeof input.history === 'object' ? (input.history as Record<string, unknown>) : null;
  if (!history) return null;
  const signals = readProjectSignals(input.signals);
  let cases = readCases(history);
  if (!cases.length) cases = casesFromMilestones(history);
  const pendingRefs = new Set(
    (Array.isArray(history.pendingApplications) ? (history.pendingApplications as Array<Record<string, unknown>>) : [])
      .map((p) => str(p?.caseRef)).filter(Boolean),
  );
  const status = history.status && typeof history.status === 'object' ? (history.status as Record<string, unknown>) : {};
  const events: StoryEvent[] = [];

  /* ── approvals: consecutive approvals within two years are one event ── */
  const approvals = cases.flatMap((c) => c.decisions.filter(isApproval).map((d) => ({ c, d })));
  const runs: Array<typeof approvals> = [];
  for (const a of approvals) {
    const run = runs[runs.length - 1];
    if (run && monthsBetween(run[run.length - 1].d.date, a.d.date) <= 24) run.push(a);
    else runs.push([a]);
  }
  for (const run of runs) {
    const first = run[0], last = run[run.length - 1];
    const k2a = run.map((x) => k2Of(x.c)).find((n) => n !== null) ?? null;
    const k2b = [...run].reverse().map((x) => k2Of(x.c)).find((n) => n !== null) ?? null;
    events.push({
      id: `approval-${first.d.date}`,
      track: 'PERMIT',
      stage: 'APPROVED',
      date: first.d.date,
      endDate: run.length > 1 ? last.d.date : null,
      count: run.length,
      developerClaim: false,
      what: run.length > 1
        ? `${yearsPhrase(first.d.date, last.d.date)} ქალაქმა პროექტი ${run.length} გადაწყვეტილებით შეათანხმა და დააზუსტა.`
        : `${kaOnDay(first.d.date) ?? yearsPhrase(first.d.date, null)} ქალაქმა პროექტის ეტაპი შეათანხმა.`,
      changed: k2a !== null && k2b !== null && k2a !== k2b ? `შენობის K-2 ფართობი ${fmt(k2a)} მ²-დან ${fmt(k2b)} მ²-მდე შეიცვალა.` : null,
      why: 'შეთანხმებული პროექტი მშენებლობის ნებართვის წინაპირობაა. ის ადგენს, რა ზომის და რა დანიშნულების შენობა შეიძლება აშენდეს.',
      evidence: run.map((x) => ({ caseRef: x.c.caseRef, decisionNumber: x.d.number, date: x.d.date })),
    });
  }

  /* ── permits: the one in force alone; the ones it replaced, together ── */
  const permits = cases.flatMap((c) => c.decisions.filter(isPermit).map((d) => ({ c, d }))).sort((a, b) => (a.d.date ?? '').localeCompare(b.d.date ?? ''));
  const current = permits[permits.length - 1] ?? null;
  const earlier = permits.slice(0, -1);
  if (earlier.length) {
    const corrected = earlier.some((x) => /CORRECTED/.test(x.d.effect ?? ''));
    events.push({
      id: `permits-${earlier[0].d.date}`,
      track: 'PERMIT',
      stage: 'APPROVED',
      date: earlier[0].d.date,
      endDate: earlier.length > 1 ? earlier[earlier.length - 1].d.date : null,
      count: earlier.length,
      developerClaim: false,
      what: earlier.length > 1
        ? `${yearsPhrase(earlier[0].d.date, earlier[earlier.length - 1].d.date)} მშენებლობის ნებართვა ${earlier.length}-ჯერ გაიცა${corrected ? ', ყოველ ჯერზე შესწორებული პროექტისთვის' : ''}.`
        : `${kaOnDay(earlier[0].d.date) ?? ''} გაიცა მშენებლობის ნებართვა${corrected ? ' შესწორებული პროექტისთვის' : ''}.`.trim(),
      changed: 'ყოველი ახალი ნებართვა წინას ცვლის, ამიტომ ეს ნებართვები დღეს აღარ მოქმედებს.',
      why: 'ნებართვის განმეორებით გაცემა ჩვეულებრივ ნიშნავს, რომ პროექტი მშენებლობის პროცესში იცვლებოდა და ქალაქმა ცვლილება შეათანხმა.',
      evidence: earlier.map((x) => ({ caseRef: x.c.caseRef, decisionNumber: x.d.number, date: x.d.date })),
    });
  }

  /* ── the audit finding about the works ── */
  const audit = signals?.auditFinding ?? null;
  if (audit) {
    const laterPermit = current && (current.d.date ?? '') > (audit.date ?? '') ? current : null;
    events.push({
      id: `audit-${audit.date}`,
      track: 'CONSTRUCTION',
      stage: 'IMPLEMENTED',
      date: audit.date,
      endDate: null,
      count: 1,
      developerClaim: false,
      what: `${kaInMonth(audit.date) ?? ''} ქალაქის არქიტექტურის სამსახურმა, ახალი განაცხადის განხილვისას, მერიის შიდა აუდიტის წერილზე მიუთითა: მშენებლობა შეთანხმებული პროექტის დარღვევით მიმდინარეობდა.`.trim()
        + (audit.fineRequested ? ' სამსახურმა მოითხოვა მუნიციპალური ინსპექციის დადგენილება და ჯარიმის გადახდის დამადასტურებელი ქვითარი.' : ''),
      changed: laterPermit ? `${kaOnDay(laterPermit.d.date)} შესწორებული პროექტისთვის ახალი ნებართვა გაიცა.` : null,
      why: 'ეს ოფიციალურად აჩვენებს, რომ მშენებლობა ამ დროისთვის უკვე მიმდინარეობდა. შესწორებული პროექტი ჩვეულებრივ ასეთ განსხვავებას აწესრიგებს, ამიტომ ღირს იმის გარკვევა, ეხება თუ არა ცვლილება თქვენს ბინას.',
      evidence: [{ caseRef: audit.caseRef, decisionNumber: audit.decisionNumber, date: audit.date }],
    });
  }

  /* ── the permit in force ── */
  if (current) {
    const until = current.d.term?.until ?? day(status.validUntil);
    const sup = current.c.supersedesPermit;
    events.push({
      id: `permit-${current.d.date}`,
      track: 'PERMIT',
      stage: 'APPROVED',
      date: current.d.date,
      endDate: null,
      count: 1,
      developerClaim: false,
      what: `${kaOnDay(current.d.date)} ქალაქმა ${/CORRECTED/.test(current.d.effect ?? '') ? 'შესწორებული პროექტისთვის ' : ''}მშენებლობის ნებართვა გასცა.`,
      changed: [until ? `ნებართვის ვადა ${kaOnDay(until)} იწურება.` : null, sup?.date ? `ის ${kaOfDay(sup.date)} ნებართვას ცვლის.` : null].filter(Boolean).join(' ') || null,
      why: 'ეს არის ის ნებართვა, რომელიც დღეს მოქმედებს. ის მშენებლობის უფლებას იძლევა, მაგრამ არც მშენებლობის დასრულებას ადასტურებს და არც ექსპლუატაციაში მიღებას.',
      evidence: [{ caseRef: current.c.caseRef, decisionNumber: current.d.number, date: current.d.date }, ...(sup ? [{ caseRef: sup.caseRef, decisionNumber: sup.decisionNumber, date: sup.date }] : [])],
    });
  }

  /* ── photos filed with an application ── */
  const photo = signals?.photoCases.find((p) => (p.date ?? '') >= (audit?.date ?? '0000')) ?? null;
  if (photo && photo.date && (!current || photo.date > (current.d.date ?? ''))) {
    events.push({
      id: `photos-${photo.date}`,
      track: 'CONSTRUCTION',
      stage: 'DOCUMENTED',
      date: photo.date,
      endDate: null,
      count: 1,
      developerClaim: false,
      what: `${kaOnDay(photo.date)} შეტანილ განაცხადს შენობის ფოტოებიც ახლავს.`,
      changed: null,
      why: 'ფოტოები აჩვენებს, როგორ გამოიყურებოდა ობიექტი განაცხადის შეტანისას. ისინი მშენებლობის მიმდინარეობას ადასტურებს, მაგრამ დასრულებას ან ექსპლუატაციაში მიღებას ვერ ადასტურებს.',
      evidence: [{ caseRef: photo.caseRef, decisionNumber: null, date: photo.date }],
    });
  }

  /* ── the developer's own statement about the works ── */
  if (signals?.developerStatus) {
    const text = developerStatusSentence(signals.developerStatus.text);
    if (text) {
      events.push({
        id: `developer-${signals.developerStatus.date ?? 'undated'}`,
        track: 'CONSTRUCTION',
        stage: 'DOCUMENTED',
        date: signals.developerStatus.date,
        endDate: null,
        count: 1,
        developerClaim: true,
        what: text,
        changed: null,
        why: 'ეს საჯარო განცხადებაა და არა ქალაქის აქტი. სამუშაოების დასრულებას ოფიციალურად ექსპლუატაციაში მიღების აქტი ადასტურებს.',
        evidence: [],
      });
    }
  }

  /* ── applications still on file ── */
  const approvedK2 = approvedValue(input.specs, 'k2CalculationArea');
  for (const c of cases.filter((x) => x.caseRef && pendingRefs.has(x.caseRef))) {
    const unread = c.unreadResponses[0] ?? null;
    const k2 = k2Of(c);
    events.push({
      id: `pending-${c.caseRef}`,
      track: 'PERMIT',
      stage: 'PROPOSED',
      date: c.filedOn,
      endDate: null,
      count: 1,
      developerClaim: false,
      what: unread
        ? `${kaOnDay(c.filedOn)} შეტანილ განაცხადზე ქალაქმა ${kaOnDay(unread.publishedOn) ?? 'მოგვიანებით'} პასუხი გამოაქვეყნა. პასუხის შინაარსი წაკითხულ ჩანაწერებში არ ჩანს.`
        : `${kaOnDay(c.filedOn)} შეტანილია ახალი განაცხადი. ის განხილვის პროცესშია და გადაწყვეტილება ჯერ არ არის.`,
      changed: k2 !== null && approvedK2 !== null
        ? (Math.abs(k2 - approvedK2) < 0.05
          ? `განაცხადში მითითებული K-2 ფართობი (${fmt(k2)} მ²) მოქმედი ნებართვის მაჩვენებელს ემთხვევა.`
          : `განაცხადით K-2 ფართობი ${fmt(approvedK2)} მ²-დან ${fmt(k2)} მ²-მდე იცვლება. ეს მხოლოდ მოთხოვნაა.`)
        : null,
      why: 'განაცხადი თხოვნაა და არა ნებართვა. სანამ ქალაქი გადაწყვეტილებას მიიღებს, მოქმედია ბოლო ნებართვა.',
      evidence: [{ caseRef: c.caseRef, decisionNumber: unread?.number ?? null, date: c.filedOn }],
    });
  }

  events.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));

  /* ── the three tracks ── */
  const tracks: TrackSummary[] = [];
  const started = !!(audit || photo || signals?.photoCases.length);
  const devSays = signals?.developerStatus ? developerStatusSentence(signals.developerStatus.text) : null;
  tracks.push(started
    ? {
        track: 'CONSTRUCTION', state: 'STARTED_DOCUMENTED',
        text: [
          audit ? `მშენებლობა დაწყებულია: ამას ოფიციალურად აჩვენებს მერიის აუდიტის ${kaOfMonth(audit.date) ?? ''} დასკვნა.`.replace('  ', ' ') : 'მშენებლობის მიმდინარეობას ქალაქში წარდგენილი ფოტოები აჩვენებს.',
          devSays ? `${devSays} ეს საჯარო განცხადებაა და არა ოფიციალური აქტი.` : null,
        ].filter(Boolean).join(' '),
      }
    : { track: 'CONSTRUCTION', state: 'NOT_DOCUMENTED', text: 'მშენებლობის მიმდინარეობის ოფიციალური ჩანაწერი წაკითხულ დოკუმენტებში არ ჩანს. ეს არ ნიშნავს, რომ მშენებლობა არ დაწყებულა.' });
  const until = current?.d.term?.until ?? day(status.validUntil);
  tracks.push(current
    ? {
        track: 'PERMIT', state: 'PERMIT_IN_FORCE',
        text: [`მოქმედი ნებართვა ${kaOnDay(current.d.date)} გაიცა${until ? ` და ${kaOnDay(until)} იწურება` : ''}.`, pendingRefs.size ? `ამის შემდეგ შეტანილი ${pendingRefs.size} განაცხადი ჯერ გადაწყვეტილების გარეშეა.` : null].filter(Boolean).join(' '),
      }
    : { track: 'PERMIT', state: 'PERMIT_UNKNOWN', text: 'მოქმედი მშენებლობის ნებართვა წაკითხულ ჩანაწერებში არ ჩანს.' });
  const commissioned = String(status.state ?? '').toUpperCase() === 'COMMISSIONED' || legalConfirmed(history, 'COMMISSIONING_APPROVED');
  tracks.push(commissioned
    ? { track: 'COMMISSIONING', state: 'COMMISSIONED', text: 'ქალაქის აქტით შენობა ექსპლუატაციაში მიღებულია.' }
    : { track: 'COMMISSIONING', state: 'NO_ACT_SEEN', text: 'ექსპლუატაციაში მიღების აქტი წაკითხულ ჩანაწერებში არ ჩანს. ეს ცალკე ოფიციალური ეტაპია, რომელსაც ვერც ნებართვა და ვერც ფოტოები ჩაანაცვლებს.' });

  if (!events.length) return null;
  return { tracks, events };
}


function approvedValue(specs: unknown, key: string): number | null {
  if (!Array.isArray(specs)) return null;
  const row = (specs as Array<Record<string, unknown>>).find((s) => s?.key === key && String(s?.status).toUpperCase() === 'APPROVED' && typeof s?.numeric === 'number');
  return row ? (row.numeric as number) : null;
}

function legalConfirmed(history: Record<string, unknown>, key: string): boolean {
  const legal = Array.isArray(history.legal) ? (history.legal as Array<Record<string, unknown>>) : [];
  return legal.some((l) => str(l?.key).toUpperCase() === key && str(l?.status).toUpperCase() === 'CONFIRMED');
}

/**
 * The developer's description of the works, as the developer's: first
 * sentence only, provenance opening and any "this is not commissioning"
 * clause removed (the event says that once, in its own words).
 */
export function developerStatusSentence(text: string): string | null {
  const first = replaceDashes(stripProvenanceOpening(text.replace(/\s+/g, ' ').trim())).split(/(?<=[.!?])\s+/)[0] ?? '';
  const clean = first.replace(/^\S*\s*წლის\s+\d+\s+\S+\s+დათარიღებულ\S*\s+საჯარო\s+განცხადებებში\s+მითითებულია,?\s*(?:რომ\s+)?/u, '').trim();
  if (!clean || clean.length < 8) return null;
  return `პროექტის საჯარო განცხადებით, ${clean.replace(/[.!?]*$/, '')}.`;
}
