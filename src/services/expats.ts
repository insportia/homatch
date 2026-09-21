// HOMATCH FOR EXPATS — everything that talks to the database.
//
// One file, so that every read the product makes is visible in one place and
// no component grows its own query. The engines in src/expats stay pure and
// take data as arguments; this is the only layer that knows Supabase exists.
//
// WHAT EVERY READ HERE HAS IN COMMON
//
// It degrades to empty rather than throwing. A foreigner reading about
// residence permits on a train with two bars of signal should get the page
// with a gap in it, not a blank screen with a retry button. Each function
// returns the honest empty value for its type and the surfaces are written
// to render that state deliberately — which is the same discipline the
// coverage-gap model applies to research.

import { supabase } from '@/db/supabase';
import type { CostCategory } from '@/expats/costOfLiving';
import type { LocatedSnapshot } from '@/expats/marketContext';
import type { Availability, AuthorityRegister, ExpatProfile, FactClass, ObservedMoney, SourceRef } from '@/expats/types';
import { EMPTY_PROFILE } from '@/expats/types';
import type { GeneratedTask } from '@/expats/plan/roadmap';
import type { PlanTask, TaskStatus } from '@/expats/plan/tasks';

/* ── Content ──────────────────────────────────────────────────────────── */

export interface TopicSection {
  kind: string;
  heading: string;
  body: string;
}

export interface TopicContent {
  title: string;
  summary: string;
  sections: TopicSection[];
}

export interface ExpatTopic {
  id: string;
  slug: string;
  domain: string;
  pathway: string | null;
  factClass: FactClass;
  register: AuthorityRegister;
  sortOrder: number;
  needsReview: boolean;
  reviewReason: string | null;
  lastVerifiedAt: string | null;
  reviewDueAt: string | null;
  /** Raw per-locale content. Resolved by `localiseTopic`. */
  content: Record<string, TopicContent>;
}

export interface TopicFact {
  id: string;
  factKey: string;
  factClass: FactClass;
  register: AuthorityRegister;
  availability: Availability;
  statement: Record<string, string>;
  value: Record<string, unknown> | null;
  appliesToNationalities: string[] | null;
  needsReview: boolean;
  sources: SourceRef[];
}

/**
 * Pick the reader's language, falling back to English.
 *
 * English rather than the first available: a foreigner who has set the
 * interface to Georgian because they are learning it should still be able
 * to read a residence rule they can act on, and a half-translated topic
 * silently served in a language they chose is worse than an English one
 * they can check. The caller is told which language it actually got so the
 * page can say so.
 */
export function localiseTopic(
  topic: ExpatTopic,
  language: string,
): { content: TopicContent; language: string; isFallback: boolean } | null {
  const exact = topic.content[language];
  if (exact) return { content: exact, language, isFallback: false };
  const english = topic.content.en;
  if (english) return { content: english, language: 'en', isFallback: true };
  return null;
}

const rowToTopic = (r: Record<string, unknown>): ExpatTopic => ({
  id: String(r.id),
  slug: String(r.slug),
  domain: String(r.domain),
  pathway: (r.pathway as string) ?? null,
  factClass: r.fact_class as FactClass,
  register: r.register as AuthorityRegister,
  sortOrder: Number(r.sort_order ?? 100),
  needsReview: Boolean(r.needs_review),
  reviewReason: (r.review_reason as string) ?? null,
  lastVerifiedAt: (r.last_verified_at as string) ?? null,
  reviewDueAt: (r.review_due_at as string) ?? null,
  content: (r.content as Record<string, TopicContent>) ?? {},
});

export async function listTopics(country = 'GE'): Promise<ExpatTopic[]> {
  const { data } = await supabase
    .from('expat_topics')
    .select(
      'id, slug, domain, pathway, fact_class, register, sort_order, needs_review, review_reason, last_verified_at, review_due_at, content',
    )
    .eq('country', country)
    .order('domain')
    .order('sort_order');
  return Array.isArray(data) ? (data as unknown as Record<string, unknown>[]).map(rowToTopic) : [];
}

export async function getTopic(slug: string): Promise<ExpatTopic | null> {
  const { data } = await supabase
    .from('expat_topics')
    .select(
      'id, slug, domain, pathway, fact_class, register, sort_order, needs_review, review_reason, last_verified_at, review_due_at, content',
    )
    .eq('slug', slug)
    .maybeSingle();
  return data ? rowToTopic(data as Record<string, unknown>) : null;
}

/**
 * The facts of a topic, each with the sources behind it.
 *
 * The citation join is done in one round trip rather than per fact. A page
 * that issues eleven requests to render eleven sourced sentences is a page
 * that renders in pieces on a slow connection.
 */
export async function getTopicFacts(topicId: string): Promise<TopicFact[]> {
  const { data } = await supabase
    .from('expat_topic_facts')
    .select(
      'id, fact_key, fact_class, register, availability, statement, value, applies_to_nationalities, needs_review,' +
        ' expat_fact_citations ( expat_citations ( id, publisher, url, official, published_on, effective_from, observed_at, language, excerpt ) )',
    )
    .eq('topic_id', topicId);

  if (!Array.isArray(data)) return [];
  const rows = data as unknown as Record<string, unknown>[];
  return rows.map((r) => {
    const links = (r.expat_fact_citations ?? []) as { expat_citations: Record<string, unknown> | null }[];
    const sources: SourceRef[] = links
      .map((l) => l.expat_citations)
      .filter((c): c is Record<string, unknown> => c !== null)
      .map((c) => ({
        sourceId: String(c.id),
        publisher: String(c.publisher),
        url: (c.url as string) ?? null,
        official: Boolean(c.official),
        publishedOn: (c.published_on as string) ?? null,
        effectiveFrom: (c.effective_from as string) ?? null,
        observedAt: String(c.observed_at),
        language: String(c.language ?? 'en'),
      }));
    return {
      id: String(r.id),
      factKey: String(r.fact_key),
      factClass: r.fact_class as FactClass,
      register: r.register as AuthorityRegister,
      availability: r.availability as Availability,
      statement: (r.statement as Record<string, string>) ?? {},
      value: (r.value as Record<string, unknown>) ?? null,
      appliesToNationalities: (r.applies_to_nationalities as string[]) ?? null,
      needsReview: Boolean(r.needs_review),
      sources,
    };
  });
}

/* ── Cost of living ───────────────────────────────────────────────────── */

export interface CostObservationRow {
  category: CostCategory;
  money: ObservedMoney;
  source: SourceRef | null;
  /** Raw per-locale note. Resolved by `localiseNote`. */
  notes: Record<string, string> | null;
}

/**
 * The note under a cost row, in the reader's language.
 *
 * Same fallback rule as `localiseTopic`, and here for the same reason: the
 * Georgian landing page used to render every heading and category in
 * Georgian and then an English paragraph inside the Internet row, because
 * this note was a plain `text` column while all the other content was
 * locale-keyed. `notes_i18n` carries the six; `notes` is the original and
 * is what a row written before that column existed still has.
 */
export function localiseNote(
  notes: Record<string, string> | null,
  language: string,
): string | null {
  if (!notes) return null;
  return notes[language] ?? notes.en ?? null;
}

export async function getCostObservations(city: string, country = 'GE'): Promise<CostObservationRow[]> {
  const { data } = await supabase
    .from('expat_cost_observations')
    .select(
      'category, low, high, currency, unit, sample_size, source_count, observed_at, district, notes, notes_i18n,' +
        ' expat_citations ( id, publisher, url, official, published_on, effective_from, observed_at, language )',
    )
    .eq('country', country)
    .eq('city', city)
    .eq('status', 'CURRENT');

  if (!Array.isArray(data)) return [];
  const rows = data as unknown as Record<string, unknown>[];
  return rows.map((r) => {
    const c = r.expat_citations as Record<string, unknown> | null;
    return {
      category: r.category as CostCategory,
      money: {
        low: Number(r.low),
        high: Number(r.high),
        currency: String(r.currency),
        unit: r.unit as ObservedMoney['unit'],
        sampleSize: Number(r.sample_size ?? 1),
        sourceCount: Number(r.source_count ?? 1),
        observedAt: String(r.observed_at),
        locality: (r.district as string) ?? city,
      },
      source: c
        ? {
            sourceId: String(c.id),
            publisher: String(c.publisher),
            url: (c.url as string) ?? null,
            official: Boolean(c.official),
            publishedOn: (c.published_on as string) ?? null,
            effectiveFrom: (c.effective_from as string) ?? null,
            observedAt: String(c.observed_at),
            language: String(c.language ?? 'en'),
          }
        : null,
      notes:
        (r.notes_i18n as Record<string, string> | null) ??
        /* A row from before notes_i18n existed still renders, in the
           language it was written in, rather than disappearing. */
        (r.notes ? { en: String(r.notes) } : null),
    };
  });
}

/** Observations keyed by category, the shape `monthlyBudget` wants. */
export function byCategory(
  rows: readonly CostObservationRow[],
): Partial<Record<CostCategory, ObservedMoney>> {
  const out: Partial<Record<CostCategory, ObservedMoney>> = {};
  for (const r of rows) out[r.category] = r.money;
  return out;
}

/* ── Market readings ──────────────────────────────────────────────────── */

/**
 * CURRENT market snapshots for a city, through the public RPC.
 *
 * Not a table read: market_snapshots is not readable by an anonymous
 * visitor and carries job ids and content hashes no customer needs. The
 * RPC returns the fields a market reading consists of and nothing else.
 */
export async function getMarketReadings(cityNameKa: string): Promise<LocatedSnapshot[]> {
  const { data } = await supabase.rpc('expat_market_readings', { p_city: cityNameKa });
  if (!Array.isArray(data)) return [];
  return data as LocatedSnapshot[];
}

/* ── The plan ─────────────────────────────────────────────────────────── */

export async function getProfile(userId: string): Promise<ExpatProfile | null> {
  const { data } = await supabase.from('expat_profiles').select('*').eq('user_id', userId).maybeSingle();
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    intents: (r.intents as ExpatProfile['intents']) ?? [],
    nationality: (r.nationality as string) ?? null,
    currentCountry: (r.current_country as string) ?? null,
    household: (r.household as ExpatProfile['household']) ?? null,
    childrenCount: r.children_count === null ? null : Number(r.children_count),
    pets: r.pets === null ? null : Boolean(r.pets),
    arrivalDate: (r.arrival_date as string) ?? null,
    intendedStayMonths: r.intended_stay_months === null ? null : Number(r.intended_stay_months),
    city: (r.city as string) ?? null,
    workStatus: (r.work_status as ExpatProfile['workStatus']) ?? null,
    housingPlan: (r.housing_plan as ExpatProfile['housingPlan']) ?? null,
    alreadyOwnsProperty: r.already_owns_property === null ? null : Boolean(r.already_owns_property),
    hasVehicle: r.has_vehicle === null ? null : Boolean(r.has_vehicle),
    homeCurrency: (r.home_currency as string) ?? null,
  };
}

export interface ReminderPreferenceRow {
  enabled: boolean;
  channels: string[];
  leadDays: number[];
  maxPerDay: number;
}

export async function getReminderPreferences(userId: string): Promise<ReminderPreferenceRow | null> {
  const { data } = await supabase
    .from('expat_profiles')
    .select('reminders_enabled, reminder_channels, reminder_lead_days, reminder_max_per_day')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    enabled: Boolean(r.reminders_enabled),
    channels: (r.reminder_channels as string[]) ?? [],
    leadDays: (r.reminder_lead_days as number[]) ?? [],
    maxPerDay: Number(r.reminder_max_per_day ?? 3),
  };
}

export async function saveProfile(userId: string, profile: ExpatProfile): Promise<{ error: string | null }> {
  const { error } = await supabase.from('expat_profiles').upsert(
    {
      user_id: userId,
      intents: profile.intents,
      nationality: profile.nationality,
      current_country: profile.currentCountry,
      household: profile.household,
      children_count: profile.childrenCount,
      pets: profile.pets,
      arrival_date: profile.arrivalDate,
      intended_stay_months: profile.intendedStayMonths,
      city: profile.city,
      work_status: profile.workStatus,
      housing_plan: profile.housingPlan,
      already_owns_property: profile.alreadyOwnsProperty,
      has_vehicle: profile.hasVehicle,
      home_currency: profile.homeCurrency,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  return { error: error ? error.message : null };
}

export async function saveReminderPreferences(
  userId: string,
  prefs: ReminderPreferenceRow,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('expat_profiles')
    .update({
      reminders_enabled: prefs.enabled,
      reminder_channels: prefs.channels,
      reminder_lead_days: prefs.leadDays,
      reminder_max_per_day: prefs.maxPerDay,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
  return { error: error ? error.message : null };
}

const rowToTask = (r: Record<string, unknown>): PlanTask => ({
  id: String(r.id),
  templateKey: String(r.template_key ?? ''),
  category: r.category as PlanTask['category'],
  stage: r.stage as PlanTask['stage'],
  titleKey: String(r.title_key ?? ''),
  whyKey: String(r.why_key ?? ''),
  topicKey: (r.topic_slug as string) ?? null,
  handoff: (r.handoff as string) ?? null,
  dependsOn: (r.depends_on as string[]) ?? [],
  status: r.status as TaskStatus,
  dueDate: (r.due_date as string) ?? null,
  deadlineBasis: r.deadline_basis as PlanTask['deadlineBasis'],
  completedAt: (r.completed_at as string) ?? null,
  notes: (r.notes as string) ?? null,
  order: Number(r.sort_order ?? 0),
  recursEveryMonths: r.recurs_every_months === null ? null : Number(r.recurs_every_months),
});

export async function getTasks(userId: string): Promise<PlanTask[]> {
  const { data } = await supabase
    .from('expat_tasks')
    .select('*')
    .eq('user_id', userId)
    .order('sort_order');
  return Array.isArray(data)
    ? (data as unknown as Record<string, unknown>[]).map(rowToTask)
    : [];
}

/**
 * Write a generated plan, preserving everything the person has already done.
 *
 * The upsert is on (user_id, template_key), so regenerating after a profile
 * change updates dates and dependencies and leaves status, completion and
 * notes exactly where they were. A regeneration that reset progress would
 * make the profile unsafe to edit, and people edit it constantly — an
 * arrival date moves more often than it does not.
 *
 * Tasks that no longer apply are NOT deleted. Somebody who ticks "I have
 * children" and then unticks it has not undone the school enrolment they
 * already completed, and deleting the row would take the record of it with
 * them. They stay, and the plan marks them as no longer applicable.
 */
export async function writePlan(
  userId: string,
  generated: readonly GeneratedTask[],
): Promise<{ error: string | null }> {
  if (generated.length === 0) return { error: null };
  const rows = generated.map((g) => ({
    user_id: userId,
    template_key: g.templateKey,
    category: g.category,
    stage: g.stage,
    title_key: g.titleKey,
    why_key: g.whyKey,
    topic_slug: g.topicKey,
    handoff: g.handoff,
    depends_on: g.dependsOn,
    due_date: g.recommendedDate,
    deadline_basis: g.deadlineBasis,
    sort_order: g.order,
    recurs_every_months: g.recursEveryMonths,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase.from('expat_tasks').upsert(rows, {
    onConflict: 'user_id,template_key',
    // Status, completed_at and notes are absent from the row shape above,
    // so an update leaves them untouched. This is the load-bearing detail.
    ignoreDuplicates: false,
  });
  return { error: error ? error.message : null };
}

export async function applyTaskStatuses(
  changes: readonly { taskId: string; status: TaskStatus; completedAt: string | null }[],
): Promise<{ error: string | null }> {
  for (const c of changes) {
    const { error } = await supabase
      .from('expat_tasks')
      .update({ status: c.status, completed_at: c.completedAt, updated_at: new Date().toISOString() })
      .eq('id', c.taskId);
    if (error) return { error: error.message };
  }
  return { error: null };
}

export async function setTaskNotes(taskId: string, notes: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('expat_tasks')
    .update({ notes, updated_at: new Date().toISOString() })
    .eq('id', taskId);
  return { error: error ? error.message : null };
}

export async function setTaskDueDate(taskId: string, dueDate: string | null): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('expat_tasks')
    .update({
      due_date: dueDate,
      // A date the person set is theirs, and is never described as a legal
      // deadline afterwards.
      deadline_basis: 'USER',
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId);
  return { error: error ? error.message : null };
}

/* ── What changed ─────────────────────────────────────────────────────── */

export interface ExpatUpdate {
  id: string;
  domain: string;
  changeType: string;
  content: Record<string, { title: string; body: string }>;
  affectsTemplateKeys: string[];
  appliesToNationalities: string[] | null;
  effectiveFrom: string | null;
  publishedAt: string | null;
  source: SourceRef | null;
}

export async function getUpdates(limit = 10, country = 'GE'): Promise<ExpatUpdate[]> {
  const { data } = await supabase
    .from('expat_updates')
    .select(
      'id, domain, change_type, content, affects_template_keys, applies_to_nationalities, effective_from, published_at,' +
        ' expat_citations ( id, publisher, url, official, published_on, effective_from, observed_at, language )',
    )
    .eq('country', country)
    .order('published_at', { ascending: false })
    .limit(limit);

  if (!Array.isArray(data)) return [];
  const rows = data as unknown as Record<string, unknown>[];
  return rows.map((r) => {
    const c = r.expat_citations as Record<string, unknown> | null;
    return {
      id: String(r.id),
      domain: String(r.domain),
      changeType: String(r.change_type),
      content: (r.content as ExpatUpdate['content']) ?? {},
      affectsTemplateKeys: (r.affects_template_keys as string[]) ?? [],
      appliesToNationalities: (r.applies_to_nationalities as string[]) ?? null,
      effectiveFrom: (r.effective_from as string) ?? null,
      publishedAt: (r.published_at as string) ?? null,
      source: c
        ? {
            sourceId: String(c.id),
            publisher: String(c.publisher),
            url: (c.url as string) ?? null,
            official: Boolean(c.official),
            publishedOn: (c.published_on as string) ?? null,
            effectiveFrom: (c.effective_from as string) ?? null,
            observedAt: String(c.observed_at),
            language: String(c.language ?? 'en'),
          }
        : null,
    };
  });
}

/* ── Rental communities: real data, not a new table ───────────────────── */

export interface RentalCommunity {
  id: string;
  name: string;
  platform: string;
  url: string | null;
  city: string | null;
  language: string | null;
  memberCount: number | null;
  lastVerifiedAt: string | null;
}

/**
 * Where people actually find flats here.
 *
 * Reads `community_directory`, which another workstream curates and
 * verifies — 28 active rows at the time of writing, each with a
 * last_verified_at. FOR EXPATS adds no table for this and invents no
 * entries: a foreigner asking where to look for a rental is answered with
 * the same rows the rest of Homatch uses.
 */
export async function getRentalCommunities(city?: string): Promise<RentalCommunity[]> {
  let query = supabase
    .from('community_directory')
    .select('id, name, platform, canonical_url, city, language, member_count, last_verified_at')
    .eq('is_active', true)
    .eq('country', 'Georgia')
    .order('member_count', { ascending: false, nullsFirst: false })
    .limit(12);
  if (city) query = query.eq('city', city);
  const { data } = await query;
  if (!Array.isArray(data)) return [];
  const rows = data as unknown as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    platform: String(r.platform),
    url: (r.canonical_url as string) ?? null,
    city: (r.city as string) ?? null,
    language: (r.language as string) ?? null,
    memberCount: r.member_count === null ? null : Number(r.member_count),
    lastVerifiedAt: (r.last_verified_at as string) ?? null,
  }));
}

/* ── Outbound attribution ─────────────────────────────────────────────── */

/**
 * Record that somebody moved towards a provider.
 *
 * Fire and forget, and deliberately so: this is telemetry about a click,
 * and a failed insert must never stop the person reaching the thing they
 * clicked. The stage is computed by the attribution engine, never supplied
 * by the caller.
 */
export async function recordOutbound(input: {
  userId: string | null;
  action: string;
  stage: string;
  providerRowId?: string | null;
  placeId?: string | null;
  researchId?: string | null;
  sponsored?: boolean;
}): Promise<void> {
  try {
    await supabase.from('expat_outbound_events').insert({
      user_id: input.userId,
      action: input.action,
      stage: input.stage,
      provider_row_id: input.providerRowId ?? null,
      place_id: input.placeId ?? null,
      research_id: input.researchId ?? null,
      sponsored: input.sponsored ?? false,
    });
  } catch {
    /* A click that was not counted is better than a click that did not work. */
  }
}

export { EMPTY_PROFILE };
