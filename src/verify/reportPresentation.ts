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

export interface TeamEntryLike { name: string; kind?: string; roles?: string[]; firstSeen?: string | null; lastSeen?: string | null; blocks?: string[] | null }
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
  /** Named for the project's land / permits (owner, applicant, client) — never the requested unit's owner. */
  ownership: boolean;
  firstSeen: string | null;
  blocks: string[];
}

const ORG_FORM = /(^|\s|["„“])(შპს|სს|ი\/მ|ააიპ|llc|ltd|jsc|ооо|оао|зао|inc\.?|bank|ბანკი)(\s|$|["“”])/iu;
const PROFESSIONAL = new Set([
  'DEVELOPER', 'ARCHITECT', 'CO_ARCHITECT', 'STRUCTURAL_ENGINEER', 'GEOTECHNICAL_SPECIALIST', 'EXPERT_REVIEW',
  'TECHNICAL_SUPERVISOR', 'CONTRACTOR', 'MEP_ENGINEER', 'LANDSCAPE_ARCHITECT', 'FIRE_SAFETY', 'SURVEYOR', 'INTERIOR_DESIGNER',
  'FINANCING', 'CREDITED',
]);
/**
 * Ownership roles: shown by name — private people included (owner, 2026-10-10)
 * — ONLY when an official municipal document names them (the `team` from the
 * TAS cases), never from a public credit, and always as the project's land /
 * permit party, never as the requested apartment's owner.
 */
export const OWNERSHIP_ROLES = new Set(['PARCEL_OWNER', 'APPLICANT', 'CO_APPLICANT', 'CLIENT']);
/** A personal number (11 digits in Georgia) or any long digit run never travels in a name. */
const ID_DIGITS = /\d{6,}/;

const nameKey = (s: string): string =>
  s.toLowerCase().replace(/["„“”'«»]/g, '').replace(/\b(შპს|სს|llc|ltd|jsc)\b/giu, '').replace(/\s+/g, ' ').trim();

/**
 * The team, merged by name across the municipal documents, public credits,
 * the developer and the financing partner. Roles are unioned; "official"
 * means at least one municipal document named them. A private person is
 * kept in a professional role, or as an officially documented land / permit
 * party (OWNERSHIP_ROLES) — the latter in its own group, never as a unit owner.
 */
export function peopleCards(input: {
  team?: TeamEntryLike[] | null;
  projectTeam?: ProjectTeamLike[] | null;
  developer?: string | null;
  financingPartner?: string | null;
}): PersonCard[] {
  const out = new Map<string, PersonCard>();
  const add = (name: string, roles: string[], o: { official: boolean; organization: boolean; roleText?: string | null; firstSeen?: string | null; lastSeen?: string | null; blocks?: string[] | null; publicStatement?: boolean; ownershipAllowed?: boolean }) => {
    const n = String(name ?? '').trim();
    if (!n || ID_DIGITS.test(n)) return;
    const kept = roles.filter((r) => !OWNERSHIP_ROLES.has(r) || (o.ownershipAllowed && o.official));
    const professional = kept.some((r) => PROFESSIONAL.has(r));
    const ownership = kept.some((r) => OWNERSHIP_ROLES.has(r));
    const organization = o.organization || ORG_FORM.test(n);
    // A private person is shown by name only in a professional role or as an
    // officially documented land / permit party.
    if (!professional && !organization && !ownership) return;
    if (!kept.length) return;
    const blocks = (o.blocks ?? []).filter(Boolean).map(String);
    const k = nameKey(n);
    const prev = out.get(k);
    if (prev) {
      for (const r of kept) if (!prev.roles.includes(r)) prev.roles.push(r);
      prev.official = prev.official || o.official;
      prev.organization = prev.organization || organization;
      prev.roleText = prev.roleText || o.roleText || null;
      prev.lastSeen = prev.lastSeen || o.lastSeen || null;
      prev.firstSeen = prev.firstSeen || o.firstSeen || null;
      prev.publicStatement = prev.publicStatement && !!o.publicStatement;
      prev.ownership = prev.ownership || ownership;
      for (const b of blocks) if (!prev.blocks.includes(b)) prev.blocks.push(b);
      return;
    }
    out.set(k, { name: n, roles: [...kept], roleText: o.roleText ?? null, official: o.official, organization, firstSeen: o.firstSeen ?? null, lastSeen: o.lastSeen ?? null, publicStatement: !!o.publicStatement, ownership, blocks });
  };
  if (input.developer) add(input.developer, ['DEVELOPER'], { official: false, organization: true });
  for (const m of input.team ?? []) {
    if (!m?.name) continue;
    const roles = (m.roles ?? []).length ? m.roles! : ['OTHER'];
    // 'OTHER' is shown only for organisations — the server rule, held again here.
    add(m.name, roles.map((r) => (r === 'OTHER' && m.kind === 'ORGANIZATION' ? 'OTHER_ORG' : r)), {
      official: true, organization: m.kind === 'ORGANIZATION', firstSeen: m.firstSeen ?? null, lastSeen: m.lastSeen ?? null, blocks: m.blocks ?? null, ownershipAllowed: true,
    });
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

export type ChapterId = 'summary' | 'explore' | 'story' | 'people' | 'building' | 'legal' | 'documents' | 'location' | 'market' | 'final';

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

/* ═══════════════════════ Verify v3 — contract views ═══════════════════════
 *
 * Every field below is produced by the intelligence layer and treated as
 * OPTIONAL: a report stored before it existed lacks it, and the view degrades
 * to the older presentation rather than to an empty or a stronger claim.
 */

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const isoDay = (v: unknown): string | null => {
  const m = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(v) : null;
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};
const newestFirst = (a: string | null, b: string | null): number => (b ?? '').localeCompare(a ?? '');

/** Only an absolute http(s) link may become an href — never javascript:, never a storage path. */
export function safeHref(v: unknown): string | null {
  const s = str(v);
  if (!/^https?:\/\/[^\s"'<>]+$/i.test(s)) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/* ───────────────────────── Project team (v2) ───────────────────────── */

export type TeamGroup =
  | 'ARCHITECTURE' | 'STRUCTURAL' | 'GEOTECHNICAL' | 'ENGINEERING' | 'DESIGN' | 'LANDSCAPE' | 'CONSTRUCTION_ORG' | 'SAFETY'
  | 'DEVELOPER' | 'APPLICANTS' | 'OTHER';
/*
 * THE ORDER A BUYER ASKS IN (owner, 2026-10-11): who designed it, who made it
 * stand up, who engineered it, then who commissioned and applied for it.
 * The professionals lead; the commissioning side follows.
 */
export const TEAM_GROUP_ORDER: TeamGroup[] = [
  'ARCHITECTURE', 'STRUCTURAL', 'GEOTECHNICAL', 'ENGINEERING', 'DESIGN', 'LANDSCAPE', 'CONSTRUCTION_ORG', 'SAFETY',
  'DEVELOPER', 'APPLICANTS', 'OTHER',
];
export const TEAM_GROUP_KEY: Record<TeamGroup, string> = {
  DEVELOPER: 'verify_v3_team_group_developer',
  ARCHITECTURE: 'verify_v3_team_group_architecture',
  STRUCTURAL: 'verify_v3_team_group_structural',
  GEOTECHNICAL: 'verify_v3_team_group_geotechnical',
  ENGINEERING: 'verify_p0_team_group_engineering',
  DESIGN: 'verify_p0_team_group_design',
  LANDSCAPE: 'verify_v3_team_group_landscape',
  CONSTRUCTION_ORG: 'verify_v3_team_group_construction_org',
  SAFETY: 'verify_v3_team_group_safety',
  APPLICANTS: 'verify_p0_team_group_applicants',
  OTHER: 'verify_v3_team_group_other',
};
/** What each group is responsible for — one line under its heading. */
export const TEAM_GROUP_DUTY_KEY: Partial<Record<TeamGroup, string>> = {
  ARCHITECTURE: 'verify_p0_team_duty_architecture',
  STRUCTURAL: 'verify_p0_team_duty_structural',
  GEOTECHNICAL: 'verify_p0_team_duty_geotechnical',
  ENGINEERING: 'verify_p0_team_duty_engineering',
  DESIGN: 'verify_p0_team_duty_design',
  DEVELOPER: 'verify_p0_team_duty_developer',
  APPLICANTS: 'verify_p0_team_duty_applicants',
};

export interface TeamRoleV2Like {
  code?: string | null;
  roleText?: string | null;
  scope?: string | null;
  caseRef?: string | null;
  date?: string | null;
  documentTitle?: string | null;
  sourceUrl?: string | null;
}
export interface TeamMemberV2Like {
  name?: string | null;
  kind?: string | null;
  group?: string | null;
  organization?: string | null;
  roles?: TeamRoleV2Like[] | null;
  firstSeen?: string | null;
  lastSeen?: string | null;
  official?: boolean | null;
}
export interface TeamRoleV2 {
  code: string | null;
  /** The record's own wording. When it is only a FORM FIELD LABEL, see `labelKey`. */
  roleText: string;
  /**
   * An i18n key for the role, set when the documented wording is a form
   * field's label ("დამკვეთ(ებ)ის სახელი და გვარი" — "client's first and last
   * name") rather than a role: the reader is told the role, never the label.
   */
  labelKey: string | null;
  scope: string | null;
  caseRef: string | null;
  date: string | null;
  documentTitle: string | null;
  sourceUrl: string | null;
}
export interface TeamCardV2 {
  name: string;
  organizationKind: boolean;
  group: TeamGroup;
  organization: string | null;
  /** The strongest documented role — the card's headline. */
  headline: TeamRoleV2;
  /** Every documented role, newest first, the headline included. */
  roles: TeamRoleV2[];
  firstSeen: string | null;
  lastSeen: string | null;
  official: boolean;
}

/**
 * A name a reader can be shown: no digits (a personal or registry number
 * never travels in a name), at most five words, no list or label punctuation
 * that marks a raw fragment ("არქიტექტორი: ..."), and at least two letters.
 *
 * Also never a masked identifier or a sentence fragment (production,
 * 01.18.06.019.055.03.01.601: "•••305) ნაცვლად - შპს „ქეი-ელ-გრუპი“"), and
 * never a common noun the extractor mistook for a name ("გამოყენებული
 * წესები" — "rules applied"; "მრავალბინიანი საცხოვრებელი სახლი" — "apartment
 * building").
 */
const NOT_A_NAME = /(ნაცვლად|დაფიქსირდეს|წესებ|წესი|სახლი|ნაგებობ|ობიექტ|პროექტ|ნებართვ|განცხად|დოკუმენტ|ბრძანებ|გადაწყვეტილ|სართულ|ფართობ|ნაკვეთ|შენობ|მიწის)/u;
export function plausibleName(v: unknown): boolean {
  const s = str(v);
  if (s.length < 2 || s.length > 90) return false;
  if (/\d/.test(s)) return false;
  if (/[:;|/\\<>{}[\]=()•*…]/.test(s)) return false;
  if (/^[-–—.,\s]/.test(s)) return false;
  const words = s.replace(/["„“”«»']/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 5) return false;
  if (NOT_A_NAME.test(s) && !ORG_FORM.test(s)) return false;
  return (s.match(/\p{L}/gu) ?? []).length >= 2;
}

/**
 * The reviewing authority, not a member of the project team. The city's
 * architecture service appears on every TAS case as the body that DECIDES; a
 * buyer reading it under "architects" would think the municipality designed
 * the building.
 */
const AUTHORITY = /(მუნიციპალიტეტ|მერია|მერიის|სსიპ|სამსახურ|სამინისტრო|საკრებულო|ministry|municipal|city hall|\bLEPL\b)/iu;
export const isAuthority = (name: unknown): boolean => AUTHORITY.test(str(name));

/** A form field's label stored as if it were the role. */
const FORM_LABEL = /(სახელი\s*(და|,)\s*გვარი|სახელწოდება\s*$|name and surname|full name)/iu;
/** A fragment that carries a personal-number marker is never shown. */
const PERSONAL_MARKER = /(პ\/ნ|პირადი\s*ნომ|personal\s*(id|no))/iu;

/** The role a reader is told, by code, when the wording is only a label. */
export const TEAM_ROLE_LABEL_KEY: Record<string, string> = {
  CHIEF_ARCHITECT: 'verify_p0_role_chief_architect',
  ARCHITECT: 'vbi_team_role_architect',
  CO_ARCHITECT: 'vbi_team_role_co_architect',
  STRUCTURAL_ENGINEER: 'vbi_team_role_structural',
  GEOTECHNICAL_SPECIALIST: 'vbi_team_role_geotechnical',
  EXPERT_REVIEW: 'vbi_team_role_expert',
  MEP_ENGINEER: 'vbi_team_role_mep',
  ENGINEER: 'verify_p0_role_engineer',
  LANDSCAPE_ARCHITECT: 'vbi_team_role_landscape',
  INTERIOR_DESIGNER: 'vbi_team_role_interior',
  DESIGNER: 'verify_p0_role_designer',
  CONTRACTOR: 'vbi_team_role_contractor',
  TECHNICAL_SUPERVISOR: 'vbi_team_role_supervisor',
  FIRE_SAFETY: 'vbi_team_role_fire',
  SURVEYOR: 'vbi_team_role_surveyor',
  DEVELOPER: 'vrx_team_role_client',
  CLIENT: 'vrx_team_role_client',
  APPLICANT: 'vrx_team_role_applicant',
  // Roles the document-level extractor names (tasProfessionals.ts, P0 .601).
  SAFETY_ASSESSMENT: 'verify_p0_role_safety_expert',
  GEOTECHNICAL_EXPERT_ASSESSMENT: 'verify_p0_role_geotech_expert',
  CONSTRUCTION_ORGANIZATION_SCHEDULE: 'verify_p0_role_construction_org',
  ARCHITECTURAL_ORGANIZATION: 'verify_p0_role_design_firm',
  DRAWING_TITLE_BLOCK: 'verify_p0_role_drawing_title_block',
};

/* Which discipline a role code belongs to. A code not listed keeps the
   group the record gave it. */
const GROUP_OF_CODE: Record<string, TeamGroup> = {
  CHIEF_ARCHITECT: 'ARCHITECTURE', ARCHITECT: 'ARCHITECTURE', CO_ARCHITECT: 'ARCHITECTURE',
  STRUCTURAL_ENGINEER: 'STRUCTURAL', EXPERT_REVIEW: 'STRUCTURAL',
  GEOTECHNICAL_SPECIALIST: 'GEOTECHNICAL',
  MEP_ENGINEER: 'ENGINEERING', ENGINEER: 'ENGINEERING',
  INTERIOR_DESIGNER: 'DESIGN', DESIGNER: 'DESIGN',
  LANDSCAPE_ARCHITECT: 'LANDSCAPE',
  CONTRACTOR: 'CONSTRUCTION_ORG', TECHNICAL_SUPERVISOR: 'CONSTRUCTION_ORG',
  FIRE_SAFETY: 'SAFETY', SAFETY_ASSESSMENT: 'SAFETY',
  GEOTECHNICAL_EXPERT_ASSESSMENT: 'GEOTECHNICAL',
  CONSTRUCTION_ORGANIZATION_SCHEDULE: 'CONSTRUCTION_ORG',
  ARCHITECTURAL_ORGANIZATION: 'ARCHITECTURE',
  // DRAWING_TITLE_BLOCK deliberately has no discipline: a name printed in a
  // title block without a role is never promoted to architect or engineer.
};
/* How strongly a role describes what the person DID — a professional role
   heads the card over a permit application. Lower is stronger. */
const ROLE_RANK: Record<string, number> = {
  CHIEF_ARCHITECT: 0, ARCHITECT: 1, STRUCTURAL_ENGINEER: 1, GEOTECHNICAL_SPECIALIST: 1, MEP_ENGINEER: 1, ENGINEER: 1,
  LANDSCAPE_ARCHITECT: 1, INTERIOR_DESIGNER: 1, DESIGNER: 1, CO_ARCHITECT: 2, EXPERT_REVIEW: 2, CONTRACTOR: 2,
  TECHNICAL_SUPERVISOR: 2, FIRE_SAFETY: 2, SAFETY_ASSESSMENT: 2, GEOTECHNICAL_EXPERT_ASSESSMENT: 2, CONSTRUCTION_ORGANIZATION_SCHEDULE: 2, ARCHITECTURAL_ORGANIZATION: 2, DRAWING_TITLE_BLOCK: 4, SURVEYOR: 3, DEVELOPER: 4, CLIENT: 4, APPLICANT: 5,
};
const rankOf = (r: TeamRoleV2): number => ROLE_RANK[(r.code ?? '').toUpperCase()] ?? 3;
/** Roles that only say who commissioned or filed — never a discipline. */
const COMMISSIONING = new Set(['APPLICANT', 'CLIENT', 'DEVELOPER']);

const cleanText = (v: unknown, max = 220): string | null => {
  const s = str(v).replace(/\s+/g, ' ');
  return s && s.length <= max ? s : s ? `${s.slice(0, max - 1).trimEnd()}…` : null;
};

/**
 * The v2 team, grouped by discipline in a fixed order.
 *
 * Dropped: a member without a plausible name, the reviewing authority, and a
 * member without a single documented role. A role whose wording carries a
 * personal-number marker is dropped; one whose wording is only a form label
 * is shown by its code's role name.
 *
 * Grouping follows the STRONGEST documented role, not the extractor's guess:
 * a person who only ever applied for a permit is not listed under
 * architecture, and a company director is never presented as an architect
 * unless an official record names them in an architect's role.
 */
export function teamGroupsV2(members: unknown): Array<{ group: TeamGroup; cards: TeamCardV2[] }> {
  if (!Array.isArray(members) || !members.length) return [];
  const byKey = new Map<string, TeamCardV2>();
  for (const raw of members as TeamMemberV2Like[]) {
    if (!raw || typeof raw !== 'object' || !plausibleName(raw.name)) continue;
    const name = str(raw.name).replace(/\s+/g, ' ');
    if (isAuthority(name)) continue;
    const g = str(raw.group).toUpperCase() as TeamGroup;
    const given: TeamGroup = TEAM_GROUP_ORDER.includes(g) ? g : 'OTHER';
    const roles: TeamRoleV2[] = [];
    const seen = new Set<string>();
    for (const r of Array.isArray(raw.roles) ? raw.roles : []) {
      const roleText = cleanText(r?.roleText, 160);
      if (!roleText || PERSONAL_MARKER.test(roleText)) continue;
      const code = str(r?.code).toUpperCase() || null;
      const isLabel = FORM_LABEL.test(roleText);
      const labelKey = isLabel ? (code && TEAM_ROLE_LABEL_KEY[code]) || null : null;
      if (isLabel && !labelKey) continue;
      const role: TeamRoleV2 = {
        code,
        roleText,
        labelKey,
        scope: cleanText(r?.scope),
        caseRef: str(r?.caseRef) || null,
        date: isoDay(r?.date),
        documentTitle: cleanText(r?.documentTitle, 160),
        sourceUrl: safeHref(r?.sourceUrl),
      };
      if (role.scope && role.scope === role.roleText) role.scope = null;
      const k = `${role.labelKey ?? role.roleText}|${role.caseRef ?? ''}|${role.date ?? ''}`;
      if (seen.has(k)) continue;
      seen.add(k);
      roles.push(role);
    }
    if (!roles.length) continue;
    // The headline is the strongest role; ties keep the record's order.
    const headline = roles.map((r, i) => ({ r, i })).sort((a, b) => rankOf(a.r) - rankOf(b.r) || a.i - b.i)[0].r;
    const codes = roles.map((r) => (r.code ?? '').toUpperCase());
    const discipline = codes.map((c) => GROUP_OF_CODE[c]).find(Boolean);
    const onlyCommissioning = codes.every((c) => COMMISSIONING.has(c));
    const organizationKind = str(raw.kind).toUpperCase() === 'ORGANIZATION' || ORG_FORM.test(name);
    let group: TeamGroup = discipline ?? given;
    if (!discipline && onlyCommissioning) {
      // A developer company stays the developer; a person who commissioned
      // or applied joins the applicants — never a discipline they never held.
      group = organizationKind && codes.includes('DEVELOPER') ? 'DEVELOPER' : given === 'DEVELOPER' && organizationKind ? 'DEVELOPER' : 'APPLICANTS';
    }
    const org = str(raw.organization);
    const card: TeamCardV2 = {
      name,
      organizationKind,
      group,
      organization: org && !/\d{6,}/.test(org) && nameKey(org) !== nameKey(name) && !isAuthority(org) ? org : null,
      headline,
      roles: [...roles].sort((a, b) => newestFirst(a.date, b.date)),
      firstSeen: isoDay(raw.firstSeen),
      lastSeen: isoDay(raw.lastSeen),
      official: raw.official !== false,
    };
    const key = nameKey(name);
    const prev = byKey.get(key);
    if (prev) {
      for (const r of card.roles) if (!prev.roles.some((p) => p.roleText === r.roleText && p.caseRef === r.caseRef && p.date === r.date)) prev.roles.push(r);
      prev.roles.sort((a, b) => newestFirst(a.date, b.date));
      if (rankOf(card.headline) < rankOf(prev.headline)) { prev.headline = card.headline; prev.group = card.group; }
      prev.official = prev.official || card.official;
      prev.organization = prev.organization ?? card.organization;
      continue;
    }
    byKey.set(key, card);
  }
  const all = [...byKey.values()];
  return TEAM_GROUP_ORDER
    .map((group) => {
      const cards = all.filter((c) => c.group === group);
      // The developer group opens with the company; elsewhere the named
      // professionals come before their firms. Otherwise the data's order.
      const orgRank = (c: TeamCardV2) => (group === 'DEVELOPER' ? (c.organizationKind ? 0 : 1) : c.organizationKind ? 1 : 0);
      return { group, cards: cards.map((c, i) => ({ c, i })).sort((a, b) => orgRank(a.c) - orgRank(b.c) || a.i - b.i).map((x) => x.c) };
    })
    .filter((x) => x.cards.length > 0);
}

/** How many distinct official cases name this card — the evidence count. */
export function caseCount(card: TeamCardV2): number {
  return new Set(card.roles.map((r) => r.caseRef).filter(Boolean)).size;
}

/* ───────────────────────── Official documents ───────────────────────── */

export type DocFileKind = 'PDF' | 'IMAGE' | 'DRAWING' | 'ARCHIVE' | 'OTHER';
export type DocReadState = 'READ' | 'VISUAL' | 'UNSUPPORTED' | 'DEFERRED' | 'NOT_READ';
export type DocCaseStatus = 'UNDER_REVIEW' | 'APPROVED' | 'REFUSED' | 'HISTORICAL';

export const DOC_READ_KEY: Record<DocReadState, string> = {
  READ: 'verify_v3_doc_read_full',
  VISUAL: 'verify_v3_doc_read_visual',
  UNSUPPORTED: 'verify_v3_doc_read_unsupported',
  DEFERRED: 'verify_v3_doc_read_deferred',
  NOT_READ: 'verify_v3_doc_read_not_read',
};
export const DOC_STATUS_KEY: Record<DocCaseStatus, string> = {
  UNDER_REVIEW: 'verify_v3_doc_status_under_review',
  APPROVED: 'verify_v3_doc_status_approved',
  REFUSED: 'verify_v3_doc_status_refused',
  HISTORICAL: 'verify_v3_doc_status_historical',
};

export interface DocFileView {
  fileName: string | null;
  format: string | null;
  kind: DocFileKind;
  read: DocReadState;
  pages: number | null;
  href: string | null;
  date: string | null;
}
export interface DocCaseView {
  caseRef: string | null;
  documentId: string | null;
  date: string | null;
  title: string | null;
  status: DocCaseStatus;
  priority: 1 | 2 | null;
  href: string | null;
  files: DocFileView[];
}

export function readStateOf(outcome: unknown): DocReadState {
  const o = str(outcome).toUpperCase();
  if (!o) return 'NOT_READ';
  if (/UNSUPPORTED/.test(o)) return 'UNSUPPORTED';
  if (/DEFER|QUEUE/.test(o)) return 'DEFERRED';
  if (/VISUAL|IMAGE/.test(o)) return 'VISUAL';
  if (/^READ|TEXT|PARSED/.test(o)) return 'READ';
  return 'NOT_READ';
}

/**
 * A case's status chip. "Approved" only when the record says so — anything
 * pending, or named in the pending applications, is under review, and
 * anything unrecognised is a historical record, never an approval.
 */
export function caseStatusOf(status: unknown, pending = false): DocCaseStatus {
  const s = str(status).toUpperCase();
  if (pending || /UNDER_REVIEW|PENDING|IN_PROGRESS|SUBMITTED|განხილვ|მიმდინარე/u.test(s)) return 'UNDER_REVIEW';
  if (/REFUS|REJECT|DENIED|უარ/u.test(s)) return 'REFUSED';
  if (/^(APPROVED|ISSUED|GRANTED|SATISFIED|PERMITTED|COMPLETED_APPROVED)$|დამტკიც|გაცემ|დაკმაყოფ/u.test(s)) return 'APPROVED';
  return 'HISTORICAL';
}

/** A title a reader can use — never an id, a file hash or a bare number. */
export function readableTitle(v: unknown): string | null {
  const s = cleanText(v, 180);
  if (!s) return null;
  if (/^[\d\s./_-]+$/.test(s)) return null;
  if (/^[a-f0-9-]{16,}$/i.test(s)) return null;
  return s;
}

const FILE_KINDS = new Set<DocFileKind>(['PDF', 'IMAGE', 'DRAWING', 'ARCHIVE', 'OTHER']);

/**
 * The official document explorer: the two newest applications first (by the
 * server's priority, else by date), every older one after them newest first.
 */
export function documentExplorer(docs: unknown, pendingRefs: Iterable<string> = []): { recent: DocCaseView[]; earlier: DocCaseView[] } {
  if (!Array.isArray(docs) || !docs.length) return { recent: [], earlier: [] };
  const pending = new Set([...pendingRefs].filter(Boolean));
  const cases: DocCaseView[] = [];
  const seen = new Set<string>();
  for (const d of docs as Array<Record<string, unknown>>) {
    if (!d || typeof d !== 'object') continue;
    const caseRef = str(d.caseRef) || null;
    const documentId = str(d.documentId) || null;
    const key = caseRef ?? documentId ?? '';
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    const files: DocFileView[] = (Array.isArray(d.files) ? d.files : []).filter((f) => f && typeof f === 'object').map((f: Record<string, unknown>) => {
      const k = str(f.kind).toUpperCase() as DocFileKind;
      const format = str(f.format).replace(/^\./, '').toUpperCase().slice(0, 8) || (/\.([a-z0-9]{2,5})$/i.exec(str(f.fileName))?.[1]?.toUpperCase() ?? null);
      return {
        fileName: cleanText(f.fileName, 120),
        format,
        kind: FILE_KINDS.has(k) ? k : 'OTHER',
        read: readStateOf(f.outcome),
        pages: typeof f.pages === 'number' && Number.isInteger(f.pages) && f.pages > 0 ? f.pages : null,
        href: safeHref(f.sourceUrl),
        date: isoDay(f.date),
      };
    });
    const priority = d.priority === 1 || d.priority === 2 ? d.priority : null;
    cases.push({
      caseRef,
      documentId,
      date: isoDay(d.caseDate),
      title: readableTitle(d.title),
      status: caseStatusOf(d.status, !!caseRef && pending.has(caseRef)),
      priority,
      href: safeHref(d.publicUrl),
      files,
    });
  }
  const byDate = (a: DocCaseView, b: DocCaseView) => newestFirst(a.date, b.date);
  const prioritised = cases.filter((c) => c.priority).sort((a, b) => (a.priority! - b.priority!) || byDate(a, b));
  const recent = (prioritised.length ? prioritised : [...cases].sort(byDate)).slice(0, 2);
  const earlier = cases.filter((c) => !recent.includes(c)).sort(byDate);
  return { recent, earlier };
}

/**
 * Which official document (and file) each extracted image came from, keyed
 * by the image id. Internal: used only to put a "view images" button next to
 * the right file — the document id never reaches the catalogued view.
 */
export function visualSources(rawVisuals: unknown): Map<string, { documentId: string; fileName: string | null }> {
  const out = new Map<string, { documentId: string; fileName: string | null }>();
  for (const r of Array.isArray(rawVisuals) ? (rawVisuals as Array<Record<string, unknown>>) : []) {
    if (!r || typeof r !== 'object') continue;
    const id = str(r.id);
    const ref = r.documentRef && typeof r.documentRef === 'object' ? (r.documentRef as Record<string, unknown>) : null;
    const documentId = str(ref?.documentId) || str(r.documentId);
    if (id && documentId) out.set(id, { documentId, fileName: str(r.fileName) || null });
  }
  return out;
}

/* ───────────────────────── Legal position ───────────────────────── */

/**
 * stage: SUBMITTED (no response yet) / UNDER_REVIEW (deficiency notices only) /
 * RESPONSE_UNREAD (a response exists whose outcome could not be read) — never
 * an approval. Labels: verify_p0_case_stage_* (scripts/verify-p0-legal-i18n-data.mjs).
 */
export interface PendingView { caseRef: string | null; date: string | null; deadline: string | null; subject: string | null; stage?: 'SUBMITTED' | 'UNDER_REVIEW' | 'RESPONSE_UNREAD' | null; lastResponseNumber?: string | null }
/** validUntil: the construction term's end the controlling act states (e.g. 7839183 → 2028-03-11). */
export interface EffectiveView { kind: string; kindKey: string; date: string | null; decisionNumber: string | null; caseRef: string | null; validUntil?: string | null }

const PENDING_STAGES = new Set(['SUBMITTED', 'UNDER_REVIEW', 'RESPONSE_UNREAD']);

const DECISION_KINDS = new Set(['application', 'permit', 'approval', 'amendment', 'extension', 'refusal', 'suspension', 'inspection', 'commissioning', 'decision']);

/**
 * Today's official position: the effective decision first, then everything
 * still under review — each pending item is ONLY "under review, not yet
 * decided", whatever its subject says. Null when the report has neither.
 */
export function legalPosition(history: unknown): { effective: EffectiveView | null; pending: PendingView[]; conflicts: number } | null {
  if (!history || typeof history !== 'object') return null;
  const h = history as Record<string, unknown>;
  const cp = (h.currentPosition && typeof h.currentPosition === 'object' ? h.currentPosition : {}) as Record<string, unknown>;
  const e = cp.effective && typeof cp.effective === 'object' ? (cp.effective as Record<string, unknown>) : null;
  let effective: EffectiveView | null = null;
  if (e && (isoDay(e.date) || str(e.decisionNumber) || str(e.caseRef))) {
    const kind = str(e.kind).toLowerCase();
    effective = {
      kind,
      kindKey: DECISION_KINDS.has(kind) ? `verify_ox_kind_${kind}` : 'verify_ox_kind_decision',
      date: isoDay(e.date),
      decisionNumber: str(e.decisionNumber) || null,
      caseRef: str(e.caseRef) || null,
      validUntil: isoDay(e.validUntil),
    };
  }
  const merged = new Map<string, PendingView>();
  const list = [
    ...(Array.isArray(h.pendingApplications) ? h.pendingApplications : []),
    ...(Array.isArray(cp.pending) ? cp.pending : []),
  ] as Array<Record<string, unknown>>;
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const stage = PENDING_STAGES.has(str(p.stage)) ? (str(p.stage) as PendingView['stage']) : null;
    const last = p.lastResponse && typeof p.lastResponse === 'object' ? str((p.lastResponse as Record<string, unknown>).number) || null : null;
    const v: PendingView = { caseRef: str(p.caseRef) || null, date: isoDay(p.date), deadline: isoDay(p.deadline), subject: cleanText(p.subject, 200), stage, lastResponseNumber: last };
    if (!v.caseRef && !v.date && !v.subject) continue;
    const k = v.caseRef ?? `${v.date}|${v.subject}`;
    const prev = merged.get(k);
    merged.set(k, prev
      ? { caseRef: prev.caseRef, date: prev.date ?? v.date, deadline: prev.deadline ?? v.deadline, subject: prev.subject ?? v.subject, stage: prev.stage ?? v.stage, lastResponseNumber: prev.lastResponseNumber ?? v.lastResponseNumber }
      : v);
  }
  const pending = [...merged.values()].sort((a, b) => newestFirst(a.date, b.date));
  const conflicts = Array.isArray(cp.conflicts) ? cp.conflicts.length : 0;
  if (!effective && !pending.length && !conflicts) return null;
  return { effective, pending, conflicts };
}

/* ───────────────────────── Technical specifications ───────────────────────── */

export type SpecGroup = 'SITE' | 'VOLUME' | 'AREAS' | 'STRUCTURE' | 'FACADE' | 'TRANSPORT' | 'OTHER';
export type SpecStatus = 'APPROVED' | 'PROPOSED' | 'UNKNOWN';
export const SPEC_GROUP_ORDER: SpecGroup[] = ['SITE', 'VOLUME', 'AREAS', 'STRUCTURE', 'FACADE', 'TRANSPORT', 'OTHER'];
export const SPEC_GROUP_KEY: Record<SpecGroup, { title: string; meaning: string }> = {
  SITE: { title: 'verify_v3_spec_group_site', meaning: 'verify_v3_spec_meaning_site' },
  VOLUME: { title: 'verify_v3_spec_group_volume', meaning: 'verify_v3_spec_meaning_volume' },
  AREAS: { title: 'verify_v3_spec_group_areas', meaning: 'verify_v3_spec_meaning_areas' },
  STRUCTURE: { title: 'verify_v3_spec_group_structure', meaning: 'verify_v3_spec_meaning_structure' },
  FACADE: { title: 'verify_v3_spec_group_facade', meaning: 'verify_v3_spec_meaning_facade' },
  TRANSPORT: { title: 'verify_v3_spec_group_transport', meaning: 'verify_v3_spec_meaning_transport' },
  OTHER: { title: 'verify_v3_spec_group_other', meaning: '' },
};
export const SPEC_STATUS_KEY: Record<SpecStatus, string> = {
  APPROVED: 'verify_v3_spec_status_approved',
  PROPOSED: 'verify_v3_spec_status_proposed',
  UNKNOWN: 'verify_v3_spec_status_unknown',
};

export interface SpecRow { key: string; label: string; value: string; status: SpecStatus; caseRef: string | null; date: string | null }

/** Ordered: the first pattern a key or label meets decides its group. */
const SPEC_RULES: Array<[SpecGroup, RegExp]> = [
  ['SITE', /land|parcel|plot|site|\bk[-_ ]?[123]\b|^k[123]|coefficient|density|ნაკვეთ|მიწის|კ[-‐ ]?[123]|კოეფიციენტ/iu],
  ['TRANSPORT', /elevator|lift|parking|garage|car|stair|ლიფტ|პარკ|ავტოსადგომ|კიბ/iu],
  ['STRUCTURE', /foundation|structur|frame|seismic|concrete|pile|საძირკვ|კონსტრუქ|კარკას|სეისმ|ბეტონ|ხიმინჯ/iu],
  ['FACADE', /facade|façade|material|cladding|window|glazing|roof|ფასად|მასალ|მოპირკეთ|ფანჯ|მინა|სახურავ/iu],
  ['AREAS', /area|sqm|m2|m²|ფართ/iu],
  ['VOLUME', /floor|stor(e)?y|height|volume|level|buildings|units?|apartments?|სართულ|სიმაღლ|მოცულობ|ბინების რაოდენობ|ერთეულ/iu],
];

export function specGroupOf(key: string, label: string): SpecGroup {
  const hay = `${key} ${label}`;
  for (const [g, re] of SPEC_RULES) if (re.test(hay)) return g;
  return 'OTHER';
}

export function specGroups(specs: unknown): Array<{ group: SpecGroup; rows: SpecRow[] }> {
  if (!Array.isArray(specs) || !specs.length) return [];
  const rows: Array<SpecRow & { group: SpecGroup; i: number }> = [];
  const seen = new Set<string>();
  (specs as Array<Record<string, unknown>>).forEach((s, i) => {
    if (!s || typeof s !== 'object') return;
    const label = cleanText(s.label, 80);
    let value = cleanText(s.value, 120);
    if (!label || !value) return;
    const unit = str(s.unit);
    if (unit && !value.toLowerCase().includes(unit.toLowerCase())) value = `${value} ${unit}`;
    const st = str(s.status).toUpperCase();
    const status: SpecStatus = st === 'APPROVED' || st === 'PROPOSED' ? st : 'UNKNOWN';
    const key = str(s.key) || label;
    const dedupe = `${key}|${value}|${status}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    rows.push({ key, label, value, status, caseRef: str(s.caseRef) || null, date: isoDay(s.date), group: specGroupOf(key, label), i });
  });
  const rank: Record<SpecStatus, number> = { APPROVED: 0, PROPOSED: 1, UNKNOWN: 2 };
  return SPEC_GROUP_ORDER
    .map((group) => ({
      group,
      rows: (() => {
        // In the data's order, with a key's approved and proposed values side
        // by side (approved first) so a pending change reads as a change.
        const inGroup = rows.filter((r) => r.group === group);
        const firstAt = new Map<string, number>();
        for (const r of inGroup) if (!firstAt.has(r.key)) firstAt.set(r.key, r.i);
        return inGroup
          .sort((a, b) => firstAt.get(a.key)! - firstAt.get(b.key)! || rank[a.status] - rank[b.status] || a.i - b.i)
          .map(({ group: _g, i: _i, ...r }) => r);
      })(),
    }))
    .filter((g) => g.rows.length > 0);
}

/* ───────────────────────── Register: ownership & security ───────────────────────── */

export interface MortgageLike { creditor?: string | null; registeredOn?: string | null; agreementNumber?: string | null; agreementDate?: string | null; level?: string | null; scope?: string | null }
export interface RegisterSourceLike { jobId?: string | null; asOf?: string | null; reused?: boolean | null }

/** A parcel code has five segments; a unit code carries building/floor/unit after it. */
export const isParcelCode = (code: unknown): boolean => /^\d{2}\.\d{2}\.\d{2}\.\d{3}\.\d{3}$/.test(str(code));

/**
 * The register, split the way a buyer needs it: who holds the record (names
 * only — a personal number never travels), the mortgages registered on the
 * apartment itself, the security sitting on the developer's parcel or
 * building, and those since removed. "Parcel-level" is said only when the
 * extract itself is the parcel's, or the record marks the mortgage so.
 */
export function registerView(register: unknown, source?: RegisterSourceLike | null): {
  owners: Array<{ name: string; company: boolean }>;
  unitMortgages: MortgageLike[];
  parcelMortgages: MortgageLike[];
  removed: number;
  disclosure: { date: string } | null;
} | null {
  if (!register || typeof register !== 'object') return null;
  const r = register as Record<string, unknown>;
  const latest = (r.latest && typeof r.latest === 'object' ? r.latest : null) as Record<string, unknown> | null;
  if (!latest) return null;
  const owners = (Array.isArray(latest.owners) ? latest.owners : [])
    .map((o: Record<string, unknown>) => ({ name: str(o?.name).replace(/\(?\s*\d{6,}\s*\)?/g, ' ').replace(/[,\s]+$/, '').replace(/\s+/g, ' ').trim(), company: str(o?.kind).toUpperCase() === 'COMPANY' }))
    .filter((o) => o.name.length >= 2);
  const parcelExtract = isParcelCode(r.cadastralCode);
  const parcelLevel = (m: MortgageLike) => parcelExtract || /PARCEL|LAND|BUILDING|DEVELOPER|PROJECT/i.test(str(m.level) || str(m.scope));
  const current = (Array.isArray(r.currentMortgages) ? r.currentMortgages : []) as MortgageLike[];
  const asOf = isoDay(source?.asOf);
  return {
    owners,
    unitMortgages: current.filter((m) => m && !parcelLevel(m)),
    parcelMortgages: current.filter((m) => m && parcelLevel(m)),
    removed: Array.isArray(r.removedMortgages) ? r.removedMortgages.length : 0,
    disclosure: source?.reused && asOf ? { date: asOf } : null,
  };
}
