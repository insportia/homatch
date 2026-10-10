/*
 * HOMATCH Verify — presentation rules for the customer report.
 *
 * React-free, so the parts that decide WHAT a reader is told can be held by
 * node --test:
 *
 *   LEGAL_STATUS_VIEW   how each legal-claim status is shown. NOT_VERIFIED is
 *                       "could not be confirmed from the records read" —
 *                       neutral, never a "no".
 *   identityNotice      the one calm sentence shown when the records concern
 *                       a different building, or only the parcel.
 *   timelineGroups      the official milestones as grouped steps
 *                       ("Design amended ×4 · 2022–2025"), each expandable to
 *                       its individual records.
 *   peopleCards         the professionals behind the project, merged across
 *                       sources, never a private person outside a
 *                       professional role.
 *   chapterOfSection    which chapter of the report each prose section sits in.
 */

/* ───────────────────────── Legal reality ───────────────────────── */

export type LegalClaimKey =
  | 'PERMIT_ISSUED' | 'CONSTRUCTION_STARTED' | 'CONSTRUCTION_COMPLETED' | 'COMMISSIONING_APPLIED' | 'COMMISSIONING_APPROVED';
export type LegalClaimStatus = 'CONFIRMED' | 'PARTIALLY_CONFIRMED' | 'CONFLICTING' | 'NOT_VERIFIED' | 'NOT_APPLICABLE';

export interface LegalClaimLike {
  key: string;
  status: string;
  basis?: Array<{ caseRef?: string | null; decisionNumber?: string | null; date?: string | null; block?: string | null }>;
}

/** The order a building lives through them. */
export const LEGAL_ORDER: LegalClaimKey[] = [
  'PERMIT_ISSUED', 'CONSTRUCTION_STARTED', 'CONSTRUCTION_COMPLETED', 'COMMISSIONING_APPLIED', 'COMMISSIONING_APPROVED',
];

export const LEGAL_CLAIM_KEY: Record<LegalClaimKey, string> = {
  PERMIT_ISSUED: 'vrx_legal_permit_issued',
  CONSTRUCTION_STARTED: 'vrx_legal_construction_started',
  CONSTRUCTION_COMPLETED: 'vrx_legal_construction_completed',
  COMMISSIONING_APPLIED: 'vrx_legal_commissioning_applied',
  COMMISSIONING_APPROVED: 'vrx_legal_commissioning_approved',
};

/**
 * Tones are deliberately limited to four and none of them is "negative":
 * a legal claim the records did not establish is not evidence that it is
 * false, and CONFLICTING asks the reader to look, it does not accuse.
 */
export type LegalTone = 'confirmed' | 'partial' | 'attention' | 'neutral';

export const LEGAL_STATUS_VIEW: Record<LegalClaimStatus, { tone: LegalTone; labelKey: string; icon: 'check' | 'half' | 'alert' | 'open' | 'dash' }> = {
  CONFIRMED: { tone: 'confirmed', labelKey: 'vrx_legal_status_confirmed', icon: 'check' },
  PARTIALLY_CONFIRMED: { tone: 'partial', labelKey: 'vrx_legal_status_partial', icon: 'half' },
  CONFLICTING: { tone: 'attention', labelKey: 'vrx_legal_status_conflicting', icon: 'alert' },
  NOT_VERIFIED: { tone: 'neutral', labelKey: 'vrx_legal_status_not_verified', icon: 'open' },
  NOT_APPLICABLE: { tone: 'neutral', labelKey: 'vrx_legal_status_not_applicable', icon: 'dash' },
};

/**
 * The five states, in life order, each with a known status. An unknown
 * status string is shown as NOT_VERIFIED — the weakest claim, never a
 * stronger one. Returns [] when the data carries no legal view at all.
 */
export function legalRows(legal: unknown): Array<{ key: LegalClaimKey; status: LegalClaimStatus; basis: NonNullable<LegalClaimLike['basis']> }> {
  if (!Array.isArray(legal) || !legal.length) return [];
  const byKey = new Map<string, LegalClaimLike>();
  for (const c of legal as LegalClaimLike[]) if (c && typeof c.key === 'string') byKey.set(c.key, c);
  if (!LEGAL_ORDER.some((k) => byKey.has(k))) return [];
  return LEGAL_ORDER.map((key) => {
    const c = byKey.get(key);
    const status = c && c.status in LEGAL_STATUS_VIEW ? (c.status as LegalClaimStatus) : 'NOT_VERIFIED';
    return { key, status, basis: Array.isArray(c?.basis) ? c!.basis! : [] };
  });
}

/* ───────────────────────── Identity ───────────────────────── */

export interface IdentityLike {
  status?: string;
  requested?: string | null;
  parcel?: string | null;
  documentedBuildings?: string[];
  nearMatches?: string[];
}

/**
 * One calm sentence and the codes behind it — or null when there is nothing
 * the reader needs told. CONFIRMED and NOT_VERIFIED say nothing here: the
 * first is the expected case, the second is not a finding about the property.
 */
export function identityNotice(identity: IdentityLike | null | undefined): { key: string; vars: Record<string, string>; codes: string[] } | null {
  if (!identity) return null;
  const requested = identity.requested ?? '';
  if (identity.status === 'UNRESOLVED_MISMATCH') {
    const codes = (identity.nearMatches ?? []).filter(Boolean).slice(0, 4);
    return { key: codes.length ? 'vrx_identity_mismatch' : 'vrx_identity_mismatch_plain', vars: { requested, codes: codes.join(', ') }, codes };
  }
  if (identity.status === 'PARCEL_ONLY') {
    const parcel = identity.parcel ?? '';
    return { key: 'vrx_identity_parcel_only', vars: { requested, parcel }, codes: parcel ? [parcel] : [] };
  }
  return null;
}

/* ───────────────────────── Timeline ───────────────────────── */

export interface MilestoneLike {
  date: string;
  kind: string;
  title?: string;
  caseRef?: string | null;
  decisionNumber?: string | null;
  outcome?: string | null;
}
export interface MilestoneGroupLike {
  kind: string;
  outcome: string | null;
  firstDate: string;
  lastDate: string;
  count: number;
  decisionNumbers?: string[];
}
export interface TimelineGroup<M extends MilestoneLike = MilestoneLike> {
  kind: string;
  outcome: string | null;
  firstDate: string;
  lastDate: string;
  count: number;
  records: M[];
}

/**
 * Grouped steps. With individual records available they are grouped here by
 * the same rule as the server's milestoneGroups (consecutive, same kind and
 * outcome), so every group can expand to exactly its own records. With only
 * the server's groups, those are shown as they are, without records.
 */
export function timelineGroups<M extends MilestoneLike>(milestones: M[] | null | undefined, groups?: MilestoneGroupLike[] | null): TimelineGroup<M>[] {
  const ms = (milestones ?? []).filter((m) => m && typeof m.date === 'string' && m.date);
  if (ms.length) {
    const out: TimelineGroup<M>[] = [];
    for (const m of [...ms].sort((a, b) => a.date.localeCompare(b.date))) {
      const last = out[out.length - 1];
      const outcome = m.outcome ?? null;
      if (last && last.kind === m.kind && last.outcome === outcome) {
        last.lastDate = m.date;
        last.count += 1;
        last.records.push(m);
      } else {
        out.push({ kind: m.kind, outcome, firstDate: m.date, lastDate: m.date, count: 1, records: [m] });
      }
    }
    return out;
  }
  return (groups ?? [])
    .filter((g) => g && typeof g.firstDate === 'string' && g.count > 0)
    .map((g) => ({ kind: g.kind, outcome: g.outcome ?? null, firstDate: g.firstDate, lastDate: g.lastDate || g.firstDate, count: g.count, records: [] as M[] }));
}

/** "2022" or "2022–2025" — years only, the group line is a summary. */
export function yearSpan(first: string, last: string): string {
  const a = /^(\d{4})/.exec(first)?.[1] ?? '';
  const b = /^(\d{4})/.exec(last)?.[1] ?? '';
  if (!a) return b;
  return !b || a === b ? a : `${a}–${b}`;
}

/* ───────────────────────── People ───────────────────────── */

export interface TeamEntryLike { name: string; kind?: string; roles?: string[]; lastSeen?: string | null }
export interface ProjectTeamLike { name: string; roles?: string[]; basis?: 'OFFICIAL' | 'PUBLIC' | string; roleText?: string | null }

export interface PersonCard {
  name: string;
  roles: string[];
  roleText: string | null;
  official: boolean;
  organization: boolean;
  lastSeen: string | null;
  /** A public statement rather than a register or municipal fact. */
  publicStatement: boolean;
}

const ORG_FORM = /(^|\s|["„“])(შპს|სს|ი\/მ|ააიპ|llc|ltd|jsc|ооо|оао|зао|inc\.?|bank|ბანკი)(\s|$|["“”])/iu;
const PROFESSIONAL = new Set([
  'DEVELOPER', 'ARCHITECT', 'CO_ARCHITECT', 'STRUCTURAL_ENGINEER', 'GEOTECHNICAL_SPECIALIST', 'EXPERT_REVIEW',
  'TECHNICAL_SUPERVISOR', 'CONTRACTOR', 'MEP_ENGINEER', 'LANDSCAPE_ARCHITECT', 'FIRE_SAFETY', 'SURVEYOR', 'INTERIOR_DESIGNER',
  'FINANCING', 'CREDITED',
]);
/** Roles that never earn a card: applicants and parcel owners may be private people. */
const NEVER_SHOWN = new Set(['PARCEL_OWNER', 'APPLICANT', 'CO_APPLICANT', 'CLIENT']);

const nameKey = (s: string): string =>
  s.toLowerCase().replace(/["„“”'«»]/g, '').replace(/\b(შპს|სს|llc|ltd|jsc)\b/giu, '').replace(/\s+/g, ' ').trim();

/**
 * The team, merged by name across the municipal documents, public credits,
 * the developer and the financing partner. Roles are unioned; "official"
 * means at least one municipal document named them. A private person is
 * kept only in a professional role; never as an applicant or parcel owner.
 */
export function peopleCards(input: {
  team?: TeamEntryLike[] | null;
  projectTeam?: ProjectTeamLike[] | null;
  developer?: string | null;
  financingPartner?: string | null;
}): PersonCard[] {
  const out = new Map<string, PersonCard>();
  const add = (name: string, roles: string[], o: { official: boolean; organization: boolean; roleText?: string | null; lastSeen?: string | null; publicStatement?: boolean }) => {
    const n = String(name ?? '').trim();
    if (!n) return;
    const kept = roles.filter((r) => !NEVER_SHOWN.has(r));
    const professional = kept.some((r) => PROFESSIONAL.has(r));
    const organization = o.organization || ORG_FORM.test(n);
    // A private person outside a professional role is never shown by name.
    if (!professional && !organization) return;
    if (!kept.length) return;
    const k = nameKey(n);
    const prev = out.get(k);
    if (prev) {
      for (const r of kept) if (!prev.roles.includes(r)) prev.roles.push(r);
      prev.official = prev.official || o.official;
      prev.organization = prev.organization || organization;
      prev.roleText = prev.roleText || o.roleText || null;
      prev.lastSeen = prev.lastSeen || o.lastSeen || null;
      prev.publicStatement = prev.publicStatement && !!o.publicStatement;
      return;
    }
    out.set(k, { name: n, roles: [...kept], roleText: o.roleText ?? null, official: o.official, organization, lastSeen: o.lastSeen ?? null, publicStatement: !!o.publicStatement });
  };
  if (input.developer) add(input.developer, ['DEVELOPER'], { official: false, organization: true });
  for (const m of input.team ?? []) {
    if (!m?.name) continue;
    const roles = (m.roles ?? []).length ? m.roles! : ['OTHER'];
    // 'OTHER' is shown only for organisations — the server rule, held again here.
    add(m.name, roles.map((r) => (r === 'OTHER' && m.kind === 'ORGANIZATION' ? 'OTHER_ORG' : r)), { official: true, organization: m.kind === 'ORGANIZATION', lastSeen: m.lastSeen ?? null });
  }
  for (const m of input.projectTeam ?? []) {
    if (!m?.name) continue;
    // A public credit with its own role words ("designer") is a professional
    // credit; a bare OTHER is kept only for an organisation.
    const roles = ((m.roles ?? []).length ? m.roles! : ['OTHER']).map((r) => (r === 'OTHER' ? (m.roleText ? 'CREDITED' : 'OTHER_ORG') : r));
    add(m.name, roles, { official: m.basis === 'OFFICIAL', organization: false, roleText: m.roleText ?? null });
  }
  if (input.financingPartner) add(input.financingPartner, ['FINANCING'], { official: false, organization: true, publicStatement: true });
  const rank = (c: PersonCard) => {
    const order = ['DEVELOPER', 'ARCHITECT', 'CO_ARCHITECT', 'CONTRACTOR', 'STRUCTURAL_ENGINEER', 'FINANCING'];
    const i = Math.min(...c.roles.map((r) => { const x = order.indexOf(r); return x === -1 ? order.length : x; }));
    return i;
  };
  return [...out.values()].sort((a, b) => rank(a) - rank(b));
}

/* ───────────────────────── Chapters ───────────────────────── */

export type ChapterId = 'summary' | 'explore' | 'story' | 'people' | 'building' | 'legal' | 'location' | 'market' | 'final';

/**
 * Which chapter a prose section belongs to. A key this list does not know —
 * including the retired standalone LEGAL section still present in stored
 * reports — is shown, never dropped: LEGAL in the legal chapter, anything
 * else with the final perspective.
 */
export function chapterOfSection(key: string): ChapterId {
  switch (key) {
    case 'SNAPSHOT':
    case 'PROJECT':
    case 'QUALITY':
      return 'building';
    case 'LOCATION':
    case 'INFRASTRUCTURE':
      return 'location';
    case 'MARKET':
      return 'market';
    case 'PEOPLE':
      return 'people';
    case 'LEGAL':
      return 'legal';
    default:
      return 'final';
  }
}

/** Fallback heading per known section, when a stored section has no title. */
export const SECTION_HEADING_KEY: Record<string, string> = {
  SNAPSHOT: 'vrx_section_snapshot',
  PROJECT: 'vrx_section_project',
  QUALITY: 'vrx_section_quality',
  LOCATION: 'vrx_section_location',
  INFRASTRUCTURE: 'vrx_section_infrastructure',
  MARKET: 'vrx_section_market',
  PEOPLE: 'vrx_section_people',
};
