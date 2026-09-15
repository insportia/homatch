// HOMATCH FOR DEVELOPERS — the money that happens after the sale.
//
// Contracts, commissions, handover and bulk repricing. Everything that can
// change a figure somebody will be paid on goes through an RPC, not a table
// write, so the permission check and the audit row happen in the same
// transaction as the change. A client that forgot to check `can('finance')`
// still cannot approve a commission.

import { supabase, run, runList, rpc } from './client';
import type {
  DevDeal, DevCommission, DevHandover, DevUnit, ContractStatus,
  HandoverChecklistItem,
} from './types';

// ── Contracts ──────────────────────────────────────────────────────────────

export interface ContractRow extends DevDeal {
  unit_number: string | null;
  project_name: string | null;
  buyer_name: string | null;
}

/**
 * The contract register.
 *
 * Buyer names come from the dev_lead_contacts view rather than a join onto
 * outreach_contacts, because that table is owner-scoped: a teammate joining
 * it directly would silently drop every row belonging to a colleague's lead.
 */
export async function listContracts(
  workspaceId: string, status?: ContractStatus | null,
): Promise<ContractRow[]> {
  let query = supabase
    .from('dev_deals')
    .select('*, dev_units(unit_number), dev_projects(name)')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });
  if (status) query = query.eq('contract_status', status);

  const rows = await runList<DevDeal & {
    dev_units: { unit_number: string } | null;
    dev_projects: { name: string } | null;
  }>('listContracts', query, workspaceId);

  const leadIds = Array.from(new Set(rows.map((r) => r.lead_id).filter(Boolean)));
  const names = new Map<string, string>();
  if (leadIds.length > 0) {
    const contacts = await runList<{ lead_id: string; full_name: string | null }>(
      'listContractBuyers',
      supabase.from('dev_lead_contacts').select('lead_id, full_name').in('lead_id', leadIds),
      workspaceId,
    );
    for (const c of contacts) if (c.full_name) names.set(c.lead_id, c.full_name);
  }

  return rows.map((r) => ({
    ...r,
    unit_number: r.dev_units?.unit_number ?? null,
    project_name: r.dev_projects?.name ?? null,
    buyer_name: names.get(r.lead_id) ?? null,
  }));
}

export async function setContractStatus(
  dealId: string, status: ContractStatus, signedOn?: string | null, note?: string | null,
): Promise<void> {
  await rpc<void>('dev_set_contract_status', {
    p_deal_id: dealId,
    p_status: status,
    p_signed_on: signedOn ?? null,
    p_note: note ?? null,
  }, dealId);
}

/** Fields a person types on the contract itself. Money is not one of them. */
export async function updateContractDetails(
  dealId: string,
  patch: Partial<Pick<DevDeal,
    'contract_number' | 'contract_date' | 'payment_method' | 'handover_target_date' | 'notes'>>,
): Promise<DevDeal> {
  return run<DevDeal>(
    'updateContractDetails',
    supabase.from('dev_deals').update(patch).eq('id', dealId).select().single(),
    dealId,
  );
}

// ── Commissions ────────────────────────────────────────────────────────────

export interface CommissionRow extends DevCommission {
  unit_number: string | null;
  contract_number: string | null;
  beneficiary_label: string;
}

export async function listCommissions(
  workspaceId: string, status?: DevCommission['status'] | null,
): Promise<CommissionRow[]> {
  let query = supabase
    .from('dev_commissions')
    .select('*, dev_deals(contract_number, dev_units(unit_number))')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);

  const rows = await runList<DevCommission & {
    dev_deals: {
      contract_number: string | null;
      dev_units: { unit_number: string } | null;
    } | null;
  }>('listCommissions', query, workspaceId);

  // A commission owed to a teammate is named through dev_team, which is the
  // only view that can see other members' names past users' own RLS.
  const userIds = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean))) as string[];
  const people = new Map<string, string>();
  if (userIds.length > 0) {
    const team = await runList<{ user_id: string; full_name: string | null; email: string | null }>(
      'listCommissionPeople',
      supabase.from('dev_team').select('user_id, full_name, email')
        .eq('workspace_id', workspaceId).in('user_id', userIds),
      workspaceId,
    );
    for (const p of team) people.set(p.user_id, p.full_name || p.email || '');
  }

  return rows.map((r) => ({
    ...r,
    unit_number: r.dev_deals?.dev_units?.unit_number ?? null,
    contract_number: r.dev_deals?.contract_number ?? null,
    beneficiary_label: r.beneficiary_name
      || (r.user_id ? people.get(r.user_id) || '' : '')
      || '',
  }));
}

export async function listDealCommissions(dealId: string): Promise<DevCommission[]> {
  return runList<DevCommission>(
    'listDealCommissions',
    supabase.from('dev_commissions').select('*').eq('deal_id', dealId)
      .order('created_at', { ascending: true }),
    dealId,
  );
}

export interface CreateCommissionInput {
  dealId: string;
  beneficiaryKind: DevCommission['beneficiary_kind'];
  userId?: string | null;
  brokerInviteId?: string | null;
  beneficiaryName?: string | null;
  basis: 'PERCENT' | 'FIXED';
  rate?: number | null;
  amount: number;
  currency: string;
  note?: string | null;
}

export async function createCommission(
  workspaceId: string, input: CreateCommissionInput,
): Promise<DevCommission> {
  return run<DevCommission>(
    'createCommission',
    supabase.from('dev_commissions').insert({
      workspace_id: workspaceId,
      deal_id: input.dealId,
      beneficiary_kind: input.beneficiaryKind,
      user_id: input.userId ?? null,
      broker_invite_id: input.brokerInviteId ?? null,
      beneficiary_name: input.beneficiaryName ?? null,
      basis: input.basis,
      rate: input.rate ?? null,
      amount: input.amount,
      currency: input.currency,
      note: input.note ?? null,
    }).select().single(),
    workspaceId,
  );
}

export async function setCommissionStatus(
  commissionId: string, status: DevCommission['status'], paidOn?: string | null,
): Promise<void> {
  await rpc<void>('dev_set_commission_status', {
    p_commission_id: commissionId, p_status: status, p_paid_on: paidOn ?? null,
  }, commissionId);
}

/** What a percentage commission comes to on a given sale price. */
export function commissionAmount(basis: 'PERCENT' | 'FIXED', rate: number, salePrice: number): number {
  if (basis === 'FIXED') return Math.max(0, Math.round(rate * 100) / 100);
  return Math.max(0, Math.round((salePrice * rate) / 100 * 100) / 100);
}

// ── Handover ───────────────────────────────────────────────────────────────

export interface HandoverRow extends DevHandover {
  unit_number: string | null;
  project_name: string | null;
  contract_number: string | null;
}

export async function listHandovers(
  workspaceId: string, status?: DevHandover['status'] | null,
): Promise<HandoverRow[]> {
  let query = supabase
    .from('dev_handovers')
    .select('*, dev_units(unit_number, dev_projects(name)), dev_deals(contract_number)')
    .eq('workspace_id', workspaceId)
    .order('target_date', { ascending: true, nullsFirst: false });
  if (status) query = query.eq('status', status);

  const rows = await runList<DevHandover & {
    dev_units: { unit_number: string; dev_projects: { name: string } | null } | null;
    dev_deals: { contract_number: string | null } | null;
  }>('listHandovers', query, workspaceId);

  return rows.map((r) => ({
    ...r,
    unit_number: r.dev_units?.unit_number ?? null,
    project_name: r.dev_units?.dev_projects?.name ?? null,
    contract_number: r.dev_deals?.contract_number ?? null,
  }));
}

export async function getHandoverForDeal(dealId: string): Promise<DevHandover | null> {
  const rows = await runList<DevHandover>(
    'getHandoverForDeal',
    supabase.from('dev_handovers').select('*').eq('deal_id', dealId).limit(1),
    dealId,
  );
  return rows[0] ?? null;
}

/**
 * The default snagging list.
 *
 * Offered as a starting point a person edits, never applied silently — a
 * handover checklist is specific to how a company works, and pretending we
 * know it would produce a tick-box nobody trusts.
 */
export const DEFAULT_HANDOVER_CHECKLIST: HandoverChecklistItem[] = [
  { label: 'dev_handover_item_balance', done: false },
  { label: 'dev_handover_item_snagging', done: false },
  { label: 'dev_handover_item_meters', done: false },
  { label: 'dev_handover_item_keys', done: false },
  { label: 'dev_handover_item_documents', done: false },
];

export interface UpsertHandoverInput {
  dealId: string;
  unitId: string;
  targetDate?: string | null;
  actualDate?: string | null;
  status?: DevHandover['status'];
  checklist?: HandoverChecklistItem[];
  responsible?: string | null;
  notes?: string | null;
}

export async function upsertHandover(
  workspaceId: string, input: UpsertHandoverInput,
): Promise<DevHandover> {
  return run<DevHandover>(
    'upsertHandover',
    supabase.from('dev_handovers').upsert({
      workspace_id: workspaceId,
      deal_id: input.dealId,
      unit_id: input.unitId,
      target_date: input.targetDate ?? null,
      actual_date: input.actualDate ?? null,
      status: input.status ?? 'PENDING',
      checklist: input.checklist ?? DEFAULT_HANDOVER_CHECKLIST,
      responsible: input.responsible ?? null,
      notes: input.notes ?? null,
    }, { onConflict: 'deal_id' }).select().single(),
    workspaceId,
  );
}

// ── Bulk inventory ─────────────────────────────────────────────────────────

export interface BulkUnitUpdate {
  status?: DevUnit['status'] | null;
  price?: number | null;
  priceDeltaPct?: number | null;
  paymentPlanId?: string | null;
  published?: boolean | null;
}

/**
 * The only bulk write path.
 *
 * It refuses RESERVED, CONTRACT_PENDING and SOLD outright — those belong to
 * the reservation and contract workflow — and it refuses a list that spans
 * two workspaces, which is the shape a crafted id array would take.
 */
export async function bulkUpdateUnits(
  unitIds: string[], change: BulkUnitUpdate,
): Promise<number> {
  const result = await rpc<{ updated: number }>('dev_bulk_update_units', {
    p_unit_ids: unitIds,
    p_status: change.status ?? null,
    p_price: change.price ?? null,
    p_price_delta_pct: change.priceDeltaPct ?? null,
    p_payment_plan_id: change.paymentPlanId ?? null,
    p_published: change.published ?? null,
  });
  return result?.updated ?? 0;
}
