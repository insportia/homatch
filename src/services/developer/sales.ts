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
  basePrice: number;
  discountPct?: number;
  finalPrice: number;
  currency: string;
  depositAmount?: number | null;
  paymentPlanId?: string | null;
  milestones?: PaymentMilestone[];
  validUntil?: string | null;
  notes?: string | null;
}

export async function createOffer(
  workspaceId: string, input: CreateOfferInput,
): Promise<DevOffer> {
  const discountAmount = Math.max(input.basePrice - input.finalPrice, 0);
  const schedule = input.milestones
    ? resolveSchedule(input.milestones, input.finalPrice)
    : [];

  const offer = await run<DevOffer>(
    'createOffer',
    supabase.from('dev_offers').insert({
      workspace_id: workspaceId,
      lead_id: input.leadId,
      unit_id: input.unitId,
      base_price: input.basePrice,
      discount_pct: input.discountPct ?? (input.basePrice > 0
        ? Math.round((discountAmount / input.basePrice) * 10000) / 100
        : 0),
      discount_amount: discountAmount,
      final_price: input.finalPrice,
      currency: input.currency,
      deposit_amount: input.depositAmount ?? null,
      payment_plan_id: input.paymentPlanId ?? null,
      schedule,
      valid_until: input.validUntil ?? null,
      notes: input.notes ?? null,
      status: 'DRAFT',
    }).select().single(),
    workspaceId,
  );

  const { addActivity } = await import('./crm');
  await addActivity(workspaceId, {
    leadId: input.leadId, unitId: input.unitId,
    kind: 'OFFER', provenance: 'HOMATCH',
    title: 'Offer prepared',
    meta: { offer_id: offer.id, final_price: input.finalPrice, currency: input.currency },
  });
  return offer;
}

export async function listOffers(leadId: string): Promise<DevOffer[]> {
  return runList<DevOffer>(
    'listOffers',
    supabase.from('dev_offers').select('*')
      .eq('lead_id', leadId).order('created_at', { ascending: false }),
    leadId,
  );
}

export async function markOfferSent(workspaceId: string, offer: DevOffer): Promise<DevOffer> {
  const updated = await run<DevOffer>(
    'markOfferSent',
    supabase.from('dev_offers')
      .update({ status: 'SENT', sent_at: new Date().toISOString() })
      .eq('id', offer.id).select().single(),
    offer.id,
  );
  const { addActivity } = await import('./crm');
  await addActivity(workspaceId, {
    leadId: offer.lead_id, unitId: offer.unit_id, kind: 'OFFER',
    provenance: 'HOMATCH', direction: 'OUT', title: 'Offer sent',
    meta: { offer_id: offer.id },
  });
  return updated;
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
