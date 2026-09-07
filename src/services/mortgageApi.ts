// src/services/mortgageApi.ts — HOMATCH Mortgage feature: all Supabase reads
// and writes go through this file, mirroring the existing src/services/api.ts
// convention (see its USERS/ACTIVITY EVENTS sections). No financial
// arithmetic happens here — this module only moves data in and out of
// Supabase; every number shown to a user is produced by
// src/mortgage/calculations (DETERMINISTIC MATH ONLY, see that folder).
import { supabase } from '@/db/supabase';
import type {
  MortgageRule,
  MortgageRuleType,
  PtiLimitRuleData,
  LtvLimitRuleData,
  SubsidyProgramRuleData,
  MortgageScenario,
  MortgageOffer,
} from '@/mortgage/types';

// ============================================================
// KNOWLEDGE BASE (versioned official rules)
// ============================================================
// Only ever reads rows the RLS policy already restricts to status='ACTIVE'
// for a non-admin caller (see mortgage_rules_select_active_public in
// 20260907120000_mortgage_feature_v1.sql) — no additional filtering is
// needed here to keep candidate/superseded/rejected rows out of the
// customer-facing calculator, the database itself guarantees that.

interface MortgageRuleRow {
  id: string;
  type: MortgageRuleType;
  title: string;
  data: unknown;
  human_explanation: string;
  official_source_url: string;
  source_authority: string;
  effective_from: string | null;
  effective_to: string | null;
  last_verified_at: string;
  status: string;
  version: number;
  supersedes_rule_id: string | null;
  country: string;
  currency: string | null;
  eligibility_dimensions: unknown;
  created_at: string;
}

function mapRuleRow<T>(row: MortgageRuleRow): MortgageRule<T> {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    data: row.data as T,
    humanExplanation: row.human_explanation,
    officialSourceUrl: row.official_source_url,
    sourceAuthority: row.source_authority,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    lastVerifiedAt: row.last_verified_at,
    status: row.status as MortgageRule<T>['status'],
    version: row.version,
    supersedesRuleId: row.supersedes_rule_id,
    country: row.country,
    currency: row.currency,
    eligibilityDimensions: row.eligibility_dimensions as Record<string, unknown> | null,
    createdAt: row.created_at,
  };
}

async function fetchActiveRules<T>(type: MortgageRuleType, country = 'GE'): Promise<MortgageRule<T>[]> {
  const { data, error } = await supabase
    .from('mortgage_rules')
    .select('*')
    .eq('type', type)
    .eq('country', country)
    .eq('status', 'ACTIVE');
  if (error) {
    // Fail closed, never fabricate a limit: an empty array means every
    // caller's "is a rule available?" check correctly answers "no, ask the
    // user" rather than silently substituting a guessed number.
    console.error('mortgageApi.fetchActiveRules failed', error);
    return [];
  }
  return (data ?? []).map(row => mapRuleRow<T>(row as MortgageRuleRow));
}

export const getActivePtiRules = () => fetchActiveRules<PtiLimitRuleData>('PTI_LIMIT');
export const getActiveLtvRules = () => fetchActiveRules<LtvLimitRuleData>('LTV_LIMIT');
export const getActiveSubsidyPrograms = () => fetchActiveRules<SubsidyProgramRuleData>('SUBSIDY_PROGRAM');
export const getEffectiveRateMethodologyRule = async () => {
  const rows = await fetchActiveRules<Record<string, unknown>>('EFFECTIVE_RATE_METHODOLOGY');
  return rows[0] ?? null;
};

// ============================================================
// SAVED / VERSIONED SCENARIOS
// ============================================================
// mortgage_scenarios has no client UPDATE policy at the database level
// (see the migration) — "recalculate" is always implemented here as a new
// insert carrying supersedesScenarioId, never an update of the old row.

interface MortgageScenarioRow {
  id: string;
  user_id: string;
  property_id: string | null;
  input: unknown;
  result: unknown;
  affordability: unknown;
  rule_version_ids: string[];
  offer_refs: string[];
  calculated_at: string;
  version: number;
  supersedes_scenario_id: string | null;
  label: string | null;
  created_at: string;
}

function mapScenarioRow(row: MortgageScenarioRow): MortgageScenario {
  return {
    id: row.id,
    userId: row.user_id,
    propertyId: row.property_id,
    input: row.input as MortgageScenario['input'],
    result: row.result as MortgageScenario['result'],
    affordability: row.affordability as MortgageScenario['affordability'],
    ruleVersionIds: row.rule_version_ids ?? [],
    offerRefs: row.offer_refs ?? [],
    calculatedAt: row.calculated_at,
    version: row.version,
    supersedesScenarioId: row.supersedes_scenario_id,
    label: row.label,
  };
}

export async function getMyMortgageScenarios(userId: string): Promise<MortgageScenario[]> {
  const { data, error } = await supabase
    .from('mortgage_scenarios')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('mortgageApi.getMyMortgageScenarios failed', error);
    return [];
  }
  return (data ?? []).map(row => mapScenarioRow(row as MortgageScenarioRow));
}

export async function saveMortgageScenario(params: {
  userId: string;
  propertyId?: string | null;
  input: MortgageScenario['input'];
  result: MortgageScenario['result'];
  affordability?: MortgageScenario['affordability'];
  ruleVersionIds: string[];
  offerRefs?: string[];
  supersedesScenarioId?: string | null;
  label?: string | null;
}): Promise<MortgageScenario | null> {
  // Recalculation is a new row: if supersedesScenarioId is set, the caller
  // is explicitly saving version N+1 while version N stays in the table,
  // untouched — never an UPDATE of the same row.
  const version = params.supersedesScenarioId
    ? (await getScenarioVersion(params.supersedesScenarioId)) + 1
    : 1;
  const { data, error } = await supabase
    .from('mortgage_scenarios')
    .insert({
      user_id: params.userId,
      property_id: params.propertyId ?? null,
      input: params.input,
      result: params.result,
      affordability: params.affordability ?? null,
      rule_version_ids: params.ruleVersionIds,
      offer_refs: params.offerRefs ?? [],
      supersedes_scenario_id: params.supersedesScenarioId ?? null,
      version,
      label: params.label ?? null,
    })
    .select('*')
    .single();
  if (error) {
    console.error('mortgageApi.saveMortgageScenario failed', error);
    return null;
  }
  return mapScenarioRow(data as MortgageScenarioRow);
}

async function getScenarioVersion(scenarioId: string): Promise<number> {
  const { data } = await supabase.from('mortgage_scenarios').select('version').eq('id', scenarioId).maybeSingle();
  return (data as { version: number } | null)?.version ?? 1;
}

export async function deleteMortgageScenario(scenarioId: string): Promise<boolean> {
  const { error } = await supabase.from('mortgage_scenarios').delete().eq('id', scenarioId);
  if (error) {
    console.error('mortgageApi.deleteMortgageScenario failed', error);
    return false;
  }
  return true;
}

// ============================================================
// BANK OFFERS (uploaded or manually entered)
// ============================================================

interface MortgageOfferRow {
  id: string;
  user_id: string;
  scenario_id: string | null;
  offer_name: string;
  source: string;
  data: unknown;
  document_storage_path: string | null;
  extraction: unknown;
  created_at: string;
}

function mapOfferRow(row: MortgageOfferRow): { id: string; offer: MortgageOffer; extraction: unknown; documentStoragePath: string | null } {
  return {
    id: row.id,
    offer: { ...(row.data as MortgageOffer), id: row.id },
    extraction: row.extraction,
    documentStoragePath: row.document_storage_path,
  };
}

export async function getMyMortgageOffers(userId: string) {
  const { data, error } = await supabase
    .from('mortgage_offers')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('mortgageApi.getMyMortgageOffers failed', error);
    return [];
  }
  return (data ?? []).map(row => mapOfferRow(row as MortgageOfferRow));
}

export async function saveMortgageOffer(params: {
  userId: string;
  offerName: string;
  source: 'USER_UPLOADED' | 'USER_MANUAL_ENTRY' | 'BANK_PUBLISHED';
  offer: MortgageOffer;
  scenarioId?: string | null;
  documentStoragePath?: string | null;
  extraction?: unknown;
}) {
  const { data, error } = await supabase
    .from('mortgage_offers')
    .insert({
      user_id: params.userId,
      scenario_id: params.scenarioId ?? null,
      offer_name: params.offerName,
      source: params.source,
      data: params.offer,
      document_storage_path: params.documentStoragePath ?? null,
      extraction: params.extraction ?? null,
    })
    .select('*')
    .single();
  if (error) {
    console.error('mortgageApi.saveMortgageOffer failed', error);
    return null;
  }
  return mapOfferRow(data as MortgageOfferRow);
}

export async function uploadMortgageOfferDocument(userId: string, file: File): Promise<string | null> {
  const path = `${userId}/${Date.now()}_${file.name}`;
  const { error } = await supabase.storage.from('mortgage-offer-documents').upload(path, file);
  if (error) {
    console.error('mortgageApi.uploadMortgageOfferDocument failed', error);
    return null;
  }
  return path;
}
