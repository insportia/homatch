// META ADS GUARD — the integrity of HOMATCH-managed campaigns, and the policy
// that answers repeated management from outside HOMATCH. Pure: the edge
// function reconciles Meta's real state, then asks this module what it
// means. Nothing here talks to Meta, and nothing here ever targets an object
// HOMATCH did not create — enforcement always resolves through HOMATCH's own
// campaign mapping.
//
// ORDER OF OPERATIONS (the only order):
//   Meta changed → reconcile exact Meta state → classify ORIGIN (a change
//   HOMATCH itself requested is never a violation) → classify the action →
//   decide NOTICE / WARNING / STRIKE / REVIEW_REQUIRED → act.
//
// FALSE-POSITIVE SAFETY: anything short of strong, multi-signal evidence goes
// to REVIEW_REQUIRED for a person. Nothing here deletes.

export interface GuardPolicy {
  windowDays: number;
  /** Points per external action, summed over the rolling window. */
  points: Record<'MANUAL_PAUSE' | 'MANUAL_RESUME' | 'MATERIAL_EDIT' | 'STRUCTURAL_EDIT', number>;
  warningPoints: number;
  strikePoints: number;
  maxStrikes: number;
  strikeExpiryDays: number;
  /** A copy proven by multiple content signals (not Meta's own provenance)
   *  may be enforced; false sends it to review. */
  enforceHighConfidenceCopy: boolean;
  duplicateCopyScore: number;
  duplicateRelatedScore: number;
  /** How long a HOMATCH-requested change shields the matching Meta change. */
  originGraceMinutes: number;
}

export const DEFAULT_GUARD_POLICY: GuardPolicy = {
  windowDays: 14,
  points: { MANUAL_PAUSE: 1, MANUAL_RESUME: 1, MATERIAL_EDIT: 2, STRUCTURAL_EDIT: 3 },
  warningPoints: 4,
  strikePoints: 8,
  maxStrikes: 5,
  strikeExpiryDays: 180,
  enforceHighConfidenceCopy: true,
  duplicateCopyScore: 8,
  duplicateRelatedScore: 3,
  originGraceMinutes: 1440,
};

export function guardPolicy(raw: unknown): GuardPolicy {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const n = (v: unknown, d: number, lo: number, hi: number) => (Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi ? Number(v) : d);
  const pts = (r.points && typeof r.points === 'object' ? r.points : {}) as Record<string, unknown>;
  const d = DEFAULT_GUARD_POLICY;
  return {
    windowDays: n(r.windowDays, d.windowDays, 1, 90),
    points: {
      MANUAL_PAUSE: n(pts.MANUAL_PAUSE, d.points.MANUAL_PAUSE, 0, 10),
      MANUAL_RESUME: n(pts.MANUAL_RESUME, d.points.MANUAL_RESUME, 0, 10),
      MATERIAL_EDIT: n(pts.MATERIAL_EDIT, d.points.MATERIAL_EDIT, 0, 10),
      STRUCTURAL_EDIT: n(pts.STRUCTURAL_EDIT, d.points.STRUCTURAL_EDIT, 0, 10),
    },
    warningPoints: n(r.warningPoints, d.warningPoints, 1, 100),
    strikePoints: n(r.strikePoints, d.strikePoints, 1, 100),
    maxStrikes: Math.round(n(r.maxStrikes, d.maxStrikes, 1, 20)),
    strikeExpiryDays: n(r.strikeExpiryDays, d.strikeExpiryDays, 1, 3650),
    enforceHighConfidenceCopy: typeof r.enforceHighConfidenceCopy === 'boolean' ? r.enforceHighConfidenceCopy : d.enforceHighConfidenceCopy,
    duplicateCopyScore: n(r.duplicateCopyScore, d.duplicateCopyScore, 3, 20),
    duplicateRelatedScore: n(r.duplicateRelatedScore, d.duplicateRelatedScore, 1, 20),
    originGraceMinutes: n(r.originGraceMinutes, d.originGraceMinutes, 1, 1440),
  };
}

/* ── CONFIGURATION + DRIFT ────────────────────────────────────────────── */

export interface ManagedAdSetState {
  id: string;
  status: string;
  dailyBudget: number;
  endTime: string | null;
  countries: string[];
  regions: string[];
  cities: string[];
  ageMin: number | null;
  ageMax: number | null;
  genders: number[];
}

export interface ManagedState {
  campaignStatus: string;
  adSets: ManagedAdSetState[];
  ads: Array<{ id: string; adsetId: string; status: string; creativeId: string | null }>;
  pageId: string | null;
  instagramId: string | null;
  leadFormId: string | null;
}

const sorted = (a: unknown[] | undefined) => [...(a ?? [])].map(String).sort();
const minute = (t: string | null) => (t ? new Date(t).toISOString().slice(0, 16) : null);

/** Meta's ad-set JSON → the compared shape (order-free, unit-free). */
export function adSetState(raw: Record<string, any>): ManagedAdSetState {
  const t = raw.targeting ?? {};
  const g = t.geo_locations ?? {};
  return {
    id: String(raw.id),
    status: String(raw.status ?? raw.effective_status ?? ''),
    dailyBudget: Math.round(Number(raw.daily_budget ?? 0)),
    endTime: minute(raw.end_time ?? null),
    countries: sorted(g.countries),
    regions: sorted((g.regions ?? []).map((x: any) => x.key)),
    cities: sorted((g.cities ?? []).map((x: any) => x.key)),
    ageMin: t.age_min != null ? Number(t.age_min) : null,
    ageMax: t.age_max != null ? Number(t.age_max) : null,
    genders: [...(t.genders ?? [])].map(Number).sort(),
  };
}

export type DriftSeverity = 'STATUS' | 'MINOR' | 'MATERIAL' | 'HIGH' | 'STRUCTURAL';
export interface DriftItem { field: string; object: string; from: unknown; to: unknown; severity: DriftSeverity }

/**
 * APPROVED vs CURRENT. Normalized before comparing, so Meta's formatting of
 * the same value is never "drift". HIGH = the change breaks what HOMATCH
 * agreed to run or bill: more budget than the fee covers, the audience's
 * countries, the identity, the lead form.
 */
export function diffState(approved: ManagedState, current: ManagedState): DriftItem[] {
  const out: DriftItem[] = [];
  if (approved.campaignStatus !== current.campaignStatus) {
    out.push({ field: 'status', object: 'campaign', from: approved.campaignStatus, to: current.campaignStatus, severity: 'STATUS' });
  }
  const byId = new Map(current.adSets.map((s) => [s.id, s]));
  for (const a of approved.adSets) {
    const c = byId.get(a.id);
    if (!c) { out.push({ field: 'adset', object: a.id, from: 'present', to: 'missing', severity: 'STRUCTURAL' }); continue; }
    if (c.status !== a.status) out.push({ field: 'status', object: a.id, from: a.status, to: c.status, severity: 'STATUS' });
    if (c.dailyBudget !== a.dailyBudget) {
      out.push({ field: 'daily_budget', object: a.id, from: a.dailyBudget, to: c.dailyBudget, severity: c.dailyBudget > a.dailyBudget ? 'HIGH' : 'MATERIAL' });
    }
    if (c.endTime !== a.endTime) {
      const later = c.endTime && a.endTime && c.endTime > a.endTime;
      out.push({ field: 'end_time', object: a.id, from: a.endTime, to: c.endTime, severity: later ? 'HIGH' : 'MATERIAL' });
    }
    if (JSON.stringify(c.countries) !== JSON.stringify(a.countries)) out.push({ field: 'countries', object: a.id, from: a.countries, to: c.countries, severity: 'HIGH' });
    if (JSON.stringify(c.regions) !== JSON.stringify(a.regions) || JSON.stringify(c.cities) !== JSON.stringify(a.cities)) {
      out.push({ field: 'locations', object: a.id, from: [...a.regions, ...a.cities], to: [...c.regions, ...c.cities], severity: 'MATERIAL' });
    }
    if (c.ageMin !== a.ageMin || c.ageMax !== a.ageMax) out.push({ field: 'age', object: a.id, from: [a.ageMin, a.ageMax], to: [c.ageMin, c.ageMax], severity: 'MATERIAL' });
    if (JSON.stringify(c.genders) !== JSON.stringify(a.genders)) out.push({ field: 'gender', object: a.id, from: a.genders, to: c.genders, severity: 'MATERIAL' });
  }
  for (const c of current.adSets) {
    if (!approved.adSets.some((a) => a.id === c.id)) out.push({ field: 'adset', object: c.id, from: 'absent', to: 'added', severity: 'STRUCTURAL' });
  }
  const approvedAds = new Map(approved.ads.map((a) => [a.id, a]));
  for (const a of current.ads) {
    const was = approvedAds.get(a.id);
    if (!was) out.push({ field: 'ad', object: a.id, from: 'absent', to: 'added', severity: 'STRUCTURAL' });
    else {
      if (was.status !== a.status) out.push({ field: 'status', object: a.id, from: was.status, to: a.status, severity: 'STATUS' });
      if (was.creativeId && a.creativeId && was.creativeId !== a.creativeId) out.push({ field: 'creative', object: a.id, from: was.creativeId, to: a.creativeId, severity: 'MATERIAL' });
    }
  }
  for (const a of approved.ads) {
    if (!current.ads.some((c) => c.id === a.id)) out.push({ field: 'ad', object: a.id, from: 'present', to: 'missing', severity: 'STRUCTURAL' });
  }
  if (approved.pageId && current.pageId && approved.pageId !== current.pageId) out.push({ field: 'page', object: 'campaign', from: approved.pageId, to: current.pageId, severity: 'HIGH' });
  if (approved.instagramId && current.instagramId && approved.instagramId !== current.instagramId) out.push({ field: 'instagram', object: 'campaign', from: approved.instagramId, to: current.instagramId, severity: 'HIGH' });
  if (approved.leadFormId && current.leadFormId && approved.leadFormId !== current.leadFormId) out.push({ field: 'lead_form', object: 'campaign', from: approved.leadFormId, to: current.leadFormId, severity: 'HIGH' });
  return out;
}

/* ── ORIGIN ───────────────────────────────────────────────────────────── */

/** A change HOMATCH itself asked Meta to make. */
export interface HomatchOperation {
  object: string;              // meta id of the campaign / ad set / ad
  field: string;               // 'status' | 'daily_budget' | 'end_time' | …
  expected: unknown;           // the value HOMATCH wrote
  requestedAt: string;         // ISO
  confirmedAt?: string | null;
}

/** True when a drift item is the echo of HOMATCH's own write. */
export function isHomatchOrigin(item: DriftItem, ops: HomatchOperation[], now: number, policy: GuardPolicy = DEFAULT_GUARD_POLICY): boolean {
  return ops.some((op) => {
    if (op.field !== item.field) return false;
    if (op.object !== item.object && !(item.object === 'campaign' && op.object === 'campaign')) return false;
    const norm = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? minute(v) : JSON.stringify(v));
    if (norm(op.expected) !== norm(item.to)) return false;
    const at = Date.parse(op.confirmedAt ?? op.requestedAt);
    return Number.isFinite(at) && now - at <= policy.originGraceMinutes * 60_000;
  });
}

export type ExternalAction =
  | 'MANUAL_PAUSE' | 'MANUAL_RESUME' | 'MATERIAL_EDIT' | 'STRUCTURAL_EDIT'
  | 'POSSIBLE_DUPLICATE' | 'CONFIRMED_DUPLICATE' | 'CONTROL_ACCESS_CHANGE';

const PAUSED = new Set(['PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED']);

/** External drift → the actions it represents (one per kind). */
export function classifyExternal(items: DriftItem[]): Array<{ action: ExternalAction; high: boolean; items: DriftItem[] }> {
  const out: Array<{ action: ExternalAction; high: boolean; items: DriftItem[] }> = [];
  const status = items.filter((i) => i.severity === 'STATUS');
  const paused = status.filter((i) => PAUSED.has(String(i.to)) && !PAUSED.has(String(i.from)));
  const resumed = status.filter((i) => String(i.to) === 'ACTIVE' && PAUSED.has(String(i.from)));
  if (paused.length) out.push({ action: 'MANUAL_PAUSE', high: false, items: paused });
  if (resumed.length) out.push({ action: 'MANUAL_RESUME', high: false, items: resumed });
  const material = items.filter((i) => i.severity === 'MATERIAL' || i.severity === 'HIGH');
  if (material.length) out.push({ action: 'MATERIAL_EDIT', high: material.some((i) => i.severity === 'HIGH'), items: material });
  const structural = items.filter((i) => i.severity === 'STRUCTURAL');
  if (structural.length) out.push({ action: 'STRUCTURAL_EDIT', high: false, items: structural });
  return out;
}

/* ── DUPLICATES ───────────────────────────────────────────────────────── */

export interface CampaignFingerprint {
  id: string;
  name: string;
  createdTime: string | null;
  sourceCampaignId: string | null;
  sourceAdIds: string[];
  imageHashes: string[];
  videoIds: string[];
  texts: string[];
  leadFormIds: string[];
  pageIds: string[];
  countries: string[];
}

export type DuplicateLevel = 'NONE' | 'POSSIBLE_RELATED' | 'HIGH_CONFIDENCE_COPY' | 'CONFIRMED_DUPLICATE';

/**
 * Is `candidate` a copy of the managed campaign? Meta's own copy provenance
 * (source_campaign_id / source_ad_id) is confirmation. Without it, a copy
 * needs the same media AND the same words AND more; a similar name alone is
 * never evidence of anything.
 */
export function duplicateLevel(managed: CampaignFingerprint & { adIds: string[]; launchedAt: string | null },
  candidate: CampaignFingerprint, policy: GuardPolicy = DEFAULT_GUARD_POLICY): { level: DuplicateLevel; score: number; signals: string[] } {
  if (candidate.id === managed.id) return { level: 'NONE', score: 0, signals: [] };
  const signals: string[] = [];
  if (candidate.sourceCampaignId && candidate.sourceCampaignId === managed.id) signals.push('META_SOURCE_CAMPAIGN');
  if (candidate.sourceAdIds.some((id) => managed.adIds.includes(id))) signals.push('META_SOURCE_AD');
  if (signals.length) return { level: 'CONFIRMED_DUPLICATE', score: 100, signals };

  const subset = (a: string[], b: string[]) => a.length > 0 && a.every((x) => b.includes(x));
  let score = 0;
  const media = [...candidate.imageHashes, ...candidate.videoIds];
  const managedMedia = [...managed.imageHashes, ...managed.videoIds];
  if (subset(media, managedMedia)) { score += 3; signals.push('SAME_MEDIA'); }
  const norm = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();
  const mt = managed.texts.map(norm).filter(Boolean);
  const ct = candidate.texts.map(norm).filter(Boolean);
  if (ct.length && ct.every((t) => mt.includes(t))) { score += 3; signals.push('SAME_TEXT'); }
  if (subset(candidate.leadFormIds, managed.leadFormIds)) { score += 2; signals.push('SAME_LEAD_FORM'); }
  if (subset(candidate.pageIds, managed.pageIds)) { score += 1; signals.push('SAME_PAGE'); }
  if (candidate.countries.length && JSON.stringify([...candidate.countries].sort()) === JSON.stringify([...managed.countries].sort())) { score += 1; signals.push('SAME_COUNTRIES'); }
  const createdAfter = candidate.createdTime && managed.launchedAt ? Date.parse(candidate.createdTime) > Date.parse(managed.launchedAt) : false;
  // Media and words must both match for a copy; the rest only adds weight.
  const core = signals.includes('SAME_MEDIA') && signals.includes('SAME_TEXT');
  if (core && createdAfter && score >= policy.duplicateCopyScore) return { level: 'HIGH_CONFIDENCE_COPY', score, signals };
  if (score >= policy.duplicateRelatedScore && (signals.includes('SAME_MEDIA') || signals.includes('SAME_TEXT'))) return { level: 'POSSIBLE_RELATED', score, signals };
  return { level: 'NONE', score, signals };
}

/* ── POLICY ───────────────────────────────────────────────────────────── */

export type GuardLevel = 'NONE' | 'NOTICE' | 'WARNING' | 'STRIKE' | 'REVIEW_REQUIRED';
export type GuardAction = 'NONE' | 'PAUSE_DUPLICATE' | 'PAUSE_CAMPAIGN';

export interface PastEvent { action: ExternalAction; level: GuardLevel; at: string }

export interface GuardDecision {
  level: GuardLevel;
  action: GuardAction;
  points: number;
  windowPoints: number;
  strikesAfter: number;
  suspend: boolean;
  customerKey: string;
}

/**
 * NOTICE → WARNING → STRIKE. Points accumulate over the rolling window and
 * start again after a strike, so one accidental pause is a notice and a
 * pattern of interference escalates. A proven duplicate is a strike at once.
 */
export function decide(input: {
  action: ExternalAction;
  high?: boolean;
  duplicate?: DuplicateLevel;
  history: PastEvent[];
  activeStrikes: number;
  now: number;
}, policy: GuardPolicy = DEFAULT_GUARD_POLICY): GuardDecision {
  const since = input.now - policy.windowDays * 86_400_000;
  const lastStrike = input.history.filter((e) => e.level === 'STRIKE').map((e) => Date.parse(e.at)).sort((a, b) => b - a)[0] ?? 0;
  const counted = input.history.filter((e) => Date.parse(e.at) >= Math.max(since, lastStrike + 1));
  const pts = (a: ExternalAction) => (a in policy.points ? policy.points[a as keyof GuardPolicy['points']] : 0);
  const before = counted.reduce((n, e) => n + pts(e.action), 0);
  const base = { points: 0, windowPoints: before, strikesAfter: input.activeStrikes, suspend: false };

  if (input.action === 'CONTROL_ACCESS_CHANGE') {
    return { ...base, level: 'NOTICE', action: 'NONE', customerKey: 'guard_connection_attention' };
  }
  if (input.action === 'CONFIRMED_DUPLICATE' || (input.duplicate === 'HIGH_CONFIDENCE_COPY' && policy.enforceHighConfidenceCopy)) {
    const strikes = input.activeStrikes + 1;
    return { ...base, level: 'STRIKE', action: 'PAUSE_DUPLICATE', strikesAfter: strikes, suspend: strikes >= policy.maxStrikes, customerKey: 'guard_duplicate_detected' };
  }
  if (input.action === 'POSSIBLE_DUPLICATE' || input.duplicate === 'HIGH_CONFIDENCE_COPY' || input.duplicate === 'POSSIBLE_RELATED') {
    return { ...base, level: 'REVIEW_REQUIRED', action: 'NONE', customerKey: 'guard_changed_in_meta' };
  }

  const p = pts(input.action);
  const total = before + p;
  const pauseForHighDrift = input.action === 'MATERIAL_EDIT' && !!input.high;
  if (total >= policy.strikePoints) {
    const strikes = input.activeStrikes + 1;
    return { level: 'STRIKE', action: pauseForHighDrift ? 'PAUSE_CAMPAIGN' : 'NONE', points: p, windowPoints: total,
      strikesAfter: strikes, suspend: strikes >= policy.maxStrikes, customerKey: 'guard_warning_count' };
  }
  if (total >= policy.warningPoints) {
    return { level: 'WARNING', action: pauseForHighDrift ? 'PAUSE_CAMPAIGN' : 'NONE', points: p, windowPoints: total,
      strikesAfter: input.activeStrikes, suspend: false, customerKey: 'guard_repeated_changes' };
  }
  return { level: 'NOTICE', action: pauseForHighDrift ? 'PAUSE_CAMPAIGN' : 'NONE', points: p, windowPoints: total,
    strikesAfter: input.activeStrikes, suspend: false, customerKey: pauseForHighDrift ? 'guard_material_change_paused' : 'guard_changed_in_meta' };
}

/** Strikes still counting: not cleared by an admin and not expired. */
export function activeStrikeCount(incidents: Array<{ level: string; status: string; created_at: string }>, now: number, policy: GuardPolicy = DEFAULT_GUARD_POLICY): number {
  const floor = now - policy.strikeExpiryDays * 86_400_000;
  return incidents.filter((i) => i.level === 'STRIKE' && i.status === 'ACTIVE' && Date.parse(i.created_at) >= floor).length;
}
