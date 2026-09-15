// HOMATCH FOR DEVELOPERS — offers, reservations, contracts, money.
//
// Every state change in this file is one RPC. Not because RPCs are tidy, but
// because each of these facts is several rows: reserving a unit writes a
// reservation, moves the unit, records the unit's history, moves the lead,
// writes the timeline entry and writes an audit row. Six writes, one fact. A
// client doing that as six requests leaves an apartment off the market with
// nothing saying why the first time a connection drops.

import { run, runList, rpc, supabase } from './client';
import type {
  DevOffer, DevReservation, DevDeal, DevScheduleRow, DevPayment,
  DevPaymentPlan, PaymentMilestone, SalesLedgerRow,
} from './types';

// ── Offers ─────────────────────────────────────────────────────────────────

/**
 * Turn a plan template into the dated instalments an offer actually proposes.
 * Resolved once, at the moment of the offer, and stored on it: editing the
 * template next month must not rewrite what somebody was already offered.
 */
export function resolveSchedule(
  milestones: PaymentMilestone[], total: number, from: Date = new Date(),
): Array<{ label: string; due_date: string | null; amount: number }> {
  return milestones.map((m, index) => {
    const amount = m.amount != null && `${m.amount}` !== ''
      ? Number(m.amount)
      : m.percent != null && `${m.percent}` !== ''
        ? Math.round(total * (Number(m.percent) / 100) * 100) / 100
        : 0;

    let due: string | null = null;
    if (m.due_date) {
      due = m.due_date;
    } else if (m.due_offset_days != null && `${m.due_offset_days}` !== '') {
      const d = new Date(from);
      d.setDate(d.getDate() + Number(m.due_offset_days));
      due = d.toISOString().slice(0, 10);
    }
    return { label: m.label || `Instalment ${index + 1}`, due_date: due, amount };
  });
}

export interface CreateOfferInput {
  leadId: string;
  unitId: string;
  discountPct?: number | null;
  discountAmount?: number | null;
  depositAmount?: number | null;
  paymentPlanId?: string | null;
  validUntil?: string | null;
  notes?: string | null;
}

/**
 * An offer is created by the DATABASE, not here.
 *
 * The price it is based on is the unit's own price read inside the same
 * transaction, and the discount permission is checked there too — a sales
 * agent may quote list price all day and may not take 8% off. Doing the
 * arithmetic in the browser and inserting the result would mean the figure
 * a customer sees is whatever the client sent.
 */
export async function createOffer(
  _workspaceId: string, input: CreateOfferInput,
): Promise<DevOffer> {
  const id = await rpc<string>('dev_create_offer', {
    p_lead_id: input.leadId,
    p_unit_id: input.unitId,
    p_discount_pct: input.discountPct ?? null,
    p_discount_amount: input.discountAmount ?? null,
    p_deposit_amount: input.depositAmount ?? null,
    p_payment_plan_id: input.paymentPlanId ?? null,
    p_valid_until: input.validUntil ?? null,
    p_notes: input.notes ?? null,
  }, input.unitId);

  return run<DevOffer>(
    'createOfferRead',
    supabase.from('dev_offers').select('*').eq('id', id).single(),
    id,
  );
}

export async function listOffers(leadId: string): Promise<DevOffer[]> {
  return runList<DevOffer>(
    'listOffers',
    supabase.from('dev_offers').select('*')
      .eq('lead_id', leadId).order('created_at', { ascending: false }),
    leadId,
  );
}

export interface OfferRow extends DevOffer {
  unit_number: string | null;
  buyer_name: string | null;
}

/** Every live offer in the workspace, for the people who chase them. */
export async function listWorkspaceOffers(
  workspaceId: string, status?: DevOffer['status'] | null,
): Promise<OfferRow[]> {
  let query = supabase
    .from('dev_offers')
    .select('*, dev_units(unit_number)')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);

  const rows = await runList<DevOffer & { dev_units: { unit_number: string } | null }>(
    'listWorkspaceOffers', query, workspaceId,
  );

  // Names come from dev_lead_contacts, never from a join onto
  // outreach_contacts — that table is owner-scoped and an inner join would
  // silently drop a colleague's rows.
  const leadIds = Array.from(new Set(rows.map((r) => r.lead_id)));
  const names = new Map<string, string>();
  if (leadIds.length > 0) {
    const contacts = await runList<{ lead_id: string; full_name: string | null }>(
      'listOfferBuyers',
      supabase.from('dev_lead_contacts').select('lead_id, full_name').in('lead_id', leadIds),
      workspaceId,
    );
    for (const c of contacts) if (c.full_name) names.set(c.lead_id, c.full_name);
  }

  return rows.map((r) => ({
    ...r,
    unit_number: r.dev_units?.unit_number ?? null,
    buyer_name: names.get(r.lead_id) ?? null,
  }));
}

export async function setOfferStatus(
  offerId: string, status: DevOffer['status'], note?: string | null,
): Promise<void> {
  await rpc<void>('dev_set_offer_status', {
    p_offer_id: offerId, p_status: status, p_note: note ?? null,
  }, offerId);
}

export async function markOfferSent(_workspaceId: string, offer: DevOffer): Promise<void> {
  await setOfferStatus(offer.id, 'SENT');
}

/** Offers whose validity date has passed. Idempotent. */
export async function expireOffers(workspaceId: string): Promise<number> {
  return rpc<number>('dev_expire_offers', { p_workspace: workspaceId }, workspaceId);
}

// ── Reservations ───────────────────────────────────────────────────────────

export interface ReserveInput {
  unitId: string;
  leadId: string;
  amount?: number | null;
  currency?: string | null;
  expiresAt?: string | null;
  offerId?: string | null;
  notes?: string | null;
}

/** Returns the new reservation's id. Refused unless the caller has 'sale'. */
export async function reserveUnit(input: ReserveInput): Promise<string> {
  return rpc<string>('dev_reserve_unit', {
    p_unit_id: input.unitId,
    p_lead_id: input.leadId,
    p_amount: input.amount ?? null,
    p_currency: input.currency ?? null,
    p_expires_at: input.expiresAt ?? null,
    p_offer_id: input.offerId ?? null,
    p_notes: input.notes ?? null,
  }, input.unitId);
}

export async function cancelReservation(reservationId: string, reason: string): Promise<void> {
  await rpc<void>('dev_cancel_reservation', {
    p_reservation_id: reservationId, p_reason: reason,
  }, reservationId);
}

export async function listReservations(
  workspaceId: string, opts: { status?: DevReservation['status'][] } = {},
): Promise<DevReservation[]> {
  let query = supabase.from('dev_reservations').select('*').eq('workspace_id', workspaceId);
  if (opts.status && opts.status.length > 0) query = query.in('status', opts.status);
  return runList<DevReservation>(
    'listReservations', query.order('reserved_at', { ascending: false }), workspaceId);
}

export async function getUnitReservation(unitId: string): Promise<DevReservation | null> {
  const rows = await runList<DevReservation>(
    'getUnitReservation',
    supabase.from('dev_reservations').select('*')
      .eq('unit_id', unitId).eq('status', 'ACTIVE').limit(1),
    unitId,
  );
  return rows[0] ?? null;
}

// ── Contract and sale ──────────────────────────────────────────────────────

export interface ConvertInput {
  reservationId: string;
  salePrice: number;
  contractNumber?: string | null;
  contractDate?: string | null;
  paymentPlanId?: string | null;
}

/** Creates the deal and materialises its payment schedule. Returns the deal id. */
export async function convertReservation(input: ConvertInput): Promise<string> {
  return rpc<string>('dev_convert_reservation', {
    p_reservation_id: input.reservationId,
    p_sale_price: input.salePrice,
    p_contract_number: input.contractNumber ?? null,
    p_contract_date: input.contractDate ?? null,
    p_payment_plan_id: input.paymentPlanId ?? null,
  }, input.reservationId);
}

export async function markDealSold(dealId: string, saleDate?: string | null): Promise<void> {
  await rpc<void>('dev_mark_deal_sold', {
    p_deal_id: dealId, p_sale_date: saleDate ?? null,
  }, dealId);
}

export async function listDeals(workspaceId: string): Promise<DevDeal[]> {
  return runList<DevDeal>(
    'listDeals',
    supabase.from('dev_deals').select('*')
      .eq('workspace_id', workspaceId).order('created_at', { ascending: false }),
    workspaceId,
  );
}

export async function getDeal(dealId: string): Promise<DevDeal> {
  return run<DevDeal>('getDeal', supabase.from('dev_deals').select('*').eq('id', dealId).single(), dealId);
}

export async function getDealByUnit(unitId: string): Promise<DevDeal | null> {
  const rows = await runList<DevDeal>(
    'getDealByUnit',
    supabase.from('dev_deals').select('*').eq('unit_id', unitId).neq('status', 'CANCELLED').limit(1),
    unitId,
  );
  return rows[0] ?? null;
}

export async function updateDeal(dealId: string, patch: Partial<DevDeal>): Promise<DevDeal> {
  return run<DevDeal>(
    'updateDeal',
    supabase.from('dev_deals').update(patch).eq('id', dealId).select().single(),
    dealId,
  );
}

// ── Money ──────────────────────────────────────────────────────────────────

export async function listSchedule(dealId: string): Promise<DevScheduleRow[]> {
  return runList<DevScheduleRow>(
    'listSchedule',
    supabase.from('dev_payment_schedule').select('*').eq('deal_id', dealId).order('seq'),
    dealId,
  );
}

export async function listPayments(
  workspaceId: string, opts: { dealId?: string; status?: DevPayment['status'][] } = {},
): Promise<DevPayment[]> {
  let query = supabase.from('dev_payments').select('*').eq('workspace_id', workspaceId);
  if (opts.dealId) query = query.eq('deal_id', opts.dealId);
  if (opts.status && opts.status.length > 0) query = query.in('status', opts.status);
  return runList<DevPayment>(
    'listPayments', query.order('paid_at', { ascending: false }), workspaceId);
}

export interface RecordPaymentInput {
  dealId: string;
  scheduleId?: string | null;
  amount: number;
  currency: string;
  paidAt: string;
  method?: string | null;
  reference?: string | null;
  documentId?: string | null;
  notes?: string | null;
}

/**
 * Recording is not confirming. This row does not count towards a single
 * collected figure anywhere in the product until somebody with the finance
 * capability has said they have seen the money.
 */
export async function recordPayment(
  workspaceId: string, input: RecordPaymentInput,
): Promise<DevPayment> {
  return run<DevPayment>(
    'recordPayment',
    supabase.from('dev_payments').insert({
      workspace_id: workspaceId,
      deal_id: input.dealId,
      schedule_id: input.scheduleId ?? null,
      amount: input.amount,
      currency: input.currency,
      paid_at: input.paidAt,
      method: input.method ?? null,
      reference: input.reference ?? null,
      document_id: input.documentId ?? null,
      notes: input.notes ?? null,
      status: 'RECORDED',
    }).select().single(),
    workspaceId,
  );
}

export async function confirmPayment(paymentId: string): Promise<void> {
  await rpc<void>('dev_confirm_payment', { p_payment_id: paymentId }, paymentId);
}

export async function rejectPayment(paymentId: string, reason: string): Promise<void> {
  await rpc<void>('dev_reject_payment', { p_payment_id: paymentId, p_reason: reason }, paymentId);
}

/** Instalments across the whole workspace, for the collections screen. */
export async function listReceivables(
  workspaceId: string, opts: { status?: DevScheduleRow['status'][]; dueBefore?: string } = {},
): Promise<DevScheduleRow[]> {
  let query = supabase.from('dev_payment_schedule').select('*').eq('workspace_id', workspaceId);
  if (opts.status && opts.status.length > 0) query = query.in('status', opts.status);
  if (opts.dueBefore) query = query.lte('due_date', opts.dueBefore);
  return runList<DevScheduleRow>(
    'listReceivables',
    query.order('due_date', { ascending: true, nullsFirst: false }).limit(500),
    workspaceId,
  );
}

// ── The sales file ─────────────────────────────────────────────────────────

export interface LedgerQuery {
  projectId?: string | null;
  from?: string | null;
  to?: string | null;
  paymentStatus?: SalesLedgerRow['payment_status'][];
  salesManager?: string | null;
}

/**
 * A view, not a table (§124). There is no second copy of the sales file that
 * can drift from the deals, the payments and the units it is made of.
 */
export async function listLedger(
  workspaceId: string, q: LedgerQuery = {},
): Promise<SalesLedgerRow[]> {
  let query = supabase.from('dev_sales_ledger').select('*').eq('workspace_id', workspaceId);
  if (q.projectId) query = query.eq('project_id', q.projectId);
  if (q.from) query = query.gte('sale_date', q.from);
  if (q.to) query = query.lte('sale_date', q.to);
  if (q.paymentStatus && q.paymentStatus.length > 0) {
    query = query.in('payment_status', q.paymentStatus);
  }
  return runList<SalesLedgerRow>(
    'listLedger', query.order('contract_date', { ascending: false, nullsFirst: false }), workspaceId);
}

export async function listPaymentPlansForProject(
  workspaceId: string, projectId: string | null,
): Promise<DevPaymentPlan[]> {
  let query = supabase.from('dev_payment_plans').select('*').eq('workspace_id', workspaceId);
  if (projectId) query = query.or(`project_id.eq.${projectId},project_id.is.null`);
  return runList<DevPaymentPlan>('listPaymentPlansForProject', query.order('name'), workspaceId);
}
