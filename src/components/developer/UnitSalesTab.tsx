import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, FileText, KeyRound, Banknote, ArrowRight, ScrollText,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Panel, EmptyState, LoadingRows, Money, formatDate,
  PaymentStatusPill, formatMoney,
} from './primitives';
import { SectionHead, MoneyBar } from './visuals';
import { getUnitReservation, getDealByUnit, listSchedule, listPayments } from '@/services/developer/sales';
import { listLeads } from '@/services/developer/crm';
import { listDocuments } from '@/services/developer/documents';
import type {
  DevUnit, DevReservation, DevDeal, DevScheduleRow, DevPayment, DevDocument,
} from '@/services/developer/types';

/**
 * ONE APARTMENT, AND EVERYTHING COMMERCIAL ATTACHED TO IT.
 *
 * The drawer could tell you an apartment's area and its price. It could not
 * tell you who wanted it, what had been offered on it, whether it was held,
 * what had been signed, or whether the money had arrived — every one of which
 * lived on a different screen, keyed by lead or by deal rather than by the
 * thing a salesperson is actually looking at.
 *
 * BUYER → UNIT → SALE, read from the unit's end. Each block is absent when
 * there is nothing in it, so an available apartment nobody has enquired about
 * shows one line saying exactly that rather than five empty panels.
 *
 * Nothing here writes. The reservation, the contract and the money are made
 * where they are made — inside transactions the database owns — and this is
 * the read that finally puts them in one place.
 */
export function UnitSalesTab({ unit }: { unit: DevUnit }) {
  const { t, lang: language } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [reservation, setReservation] = useState<DevReservation | null>(null);
  const [deal, setDeal] = useState<DevDeal | null>(null);
  const [schedule, setSchedule] = useState<DevScheduleRow[]>([]);
  const [payments, setPayments] = useState<DevPayment[]>([]);
  const [documents, setDocuments] = useState<DevDocument[]>([]);
  const [interested, setInterested] = useState<Array<{ id: string; name: string; stage: string }>>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const [res, dealRow, docs, leads] = await Promise.all([
        getUnitReservation(unit.id).catch(() => null),
        getDealByUnit(unit.id).catch(() => null),
        listDocuments(unit.workspace_id, { unitId: unit.id }).catch(() => [] as DevDocument[]),
        listLeads(unit.workspace_id, { limit: 200 }).catch(() => []),
      ]);
      if (cancelled) return;
      setReservation(res);
      setDeal(dealRow);
      setDocuments(docs);

      /* The buyers this apartment is on. Read from the leads the caller is
         already allowed to see, so an agent with only their own buyers sees
         only their own — the CRM policy decides, not this component. */
      setInterested(leads
        .filter((lead) => lead.project_id === unit.project_id)
        .slice(0, 8)
        .map((lead) => ({
          id: lead.id,
          name: lead.contact?.full_name || lead.contact?.phone || t('dev_unnamed_buyer'),
          stage: lead.stage,
        })));

      if (dealRow) {
        const [rows, paid] = await Promise.all([
          listSchedule(dealRow.id).catch(() => [] as DevScheduleRow[]),
          listPayments(unit.workspace_id, { dealId: dealRow.id }).catch(() => [] as DevPayment[]),
        ]);
        if (cancelled) return;
        setSchedule(rows);
        setPayments(paid);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [unit.id, unit.workspace_id, unit.project_id, t]);

  if (loading) return <LoadingRows rows={4} />;

  const collected = payments
    .filter((p) => p.status === 'CONFIRMED')
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const nothing = !reservation && !deal && documents.length === 0 && interested.length === 0;

  if (nothing) {
    return (
      <Panel>
        <EmptyState
          icon={<Users className="h-7 w-7" />}
          title={t('dev_unit_sales_empty_title')}
          description={t('dev_unit_sales_empty_body')}
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── The money, when there is a contract ────────────────────────── */}
      {deal && (
        <section>
          <SectionHead title={t('dev_sales_tab_contracts')} />
          <Panel className="p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <div className="min-w-0">
                <p className="text-2xs uppercase tracking-[0.12em] text-muted-foreground">
                  {deal.contract_number ?? t('dev_sales_tab_contracts')}
                </p>
                <p className="mt-0.5 tabular text-xl font-semibold tracking-tight">
                  {formatMoney(deal.sale_price, deal.currency, language)}
                </p>
              </div>
              {deal.contract_date && (
                <p className="text-2xs text-muted-foreground">
                  {formatDate(deal.contract_date, language)}
                </p>
              )}
            </div>
            <MoneyBar
              className="mt-4"
              collected={collected}
              contracted={Number(deal.sale_price)}
              overdue={schedule
                .filter((row) => row.status === 'OVERDUE')
                .reduce((sum, row) => sum + (Number(row.amount) - Number(row.paid_amount)), 0)}
              currency={deal.currency}
            />

            {/* THE SIGNED PLAN, SHOWN AND NEVER RECOMPUTED HERE. */}
            {schedule.length > 0 && (
              <ul className="mt-4 divide-y divide-border border-t border-border">
                {schedule.map((row) => (
                  <li key={row.id} className="flex items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-sm">{row.label}</span>
                    <span className="shrink-0 text-2xs text-muted-foreground">
                      {formatDate(row.due_date, language)}
                    </span>
                    <span className="shrink-0 tabular text-sm font-medium">
                      <Money amount={row.amount} currency={row.currency} />
                    </span>
                    <PaymentStatusPill status={row.status} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </section>
      )}

      {/* ── A hold, when the apartment is held ─────────────────────────── */}
      {reservation && !deal && (
        <section>
          <SectionHead title={t('dev_sales_tab_reservations')} />
          <Panel className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
            <KeyRound className="h-4 w-4 shrink-0 text-gold-ink" aria-hidden="true" />
            <span className="text-sm">
              {formatDate(reservation.reserved_at, language)}
              {reservation.expires_at
                ? ` → ${formatDate(reservation.expires_at, language)}` : ''}
            </span>
            {reservation.amount != null && (
              <span className="tabular text-sm font-medium">
                <Money amount={reservation.amount} currency={reservation.currency} />
              </span>
            )}
          </Panel>
        </section>
      )}

      {/* ── Receipts against this apartment ────────────────────────────── */}
      {payments.length > 0 && (
        <section>
          <SectionHead title={t('dev_sales_tab_payments')} />
          <Panel className="divide-y divide-border">
            {payments.map((payment) => (
              <div key={payment.id} className="flex items-center gap-3 px-4 py-2.5">
                <Banknote
                  className={payment.status === 'CONFIRMED'
                    ? 'h-4 w-4 shrink-0 text-emerald-600'
                    : 'h-4 w-4 shrink-0 text-muted-foreground'}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {payment.reference || payment.method || t('dev_sales_tab_payments')}
                </span>
                <span className="shrink-0 text-2xs text-muted-foreground">
                  {formatDate(payment.paid_at, language)}
                </span>
                <span className="shrink-0 tabular text-sm font-medium">
                  <Money amount={payment.amount} currency={payment.currency} />
                </span>
              </div>
            ))}
          </Panel>
        </section>
      )}

      {/* ── The buyers on this development ─────────────────────────────── */}
      {interested.length > 0 && (
        <section>
          <SectionHead title={t('dev_unit_sales_buyers')} sub={t('dev_unit_sales_buyers_sub')} />
          <Panel className="divide-y divide-border">
            {interested.map((lead) => (
              <Link
                key={lead.id}
                to={`/developers/contacts?lead=${lead.id}`}
                className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50"
              >
                <Users className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-sm">{lead.name}</span>
                <span className="shrink-0 text-2xs text-muted-foreground">
                  {t(`dev_stage_${lead.stage.toLowerCase()}`)}
                </span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            ))}
          </Panel>
        </section>
      )}

      {/* ── Paperwork filed against this apartment ─────────────────────── */}
      {documents.length > 0 && (
        <section>
          <SectionHead title={t('dev_nav_documents')} />
          <Panel className="divide-y divide-border">
            {documents.slice(0, 8).map((doc) => (
              <div key={doc.id} className="flex items-center gap-3 px-4 py-2.5">
                {doc.doc_type === 'CONTRACT'
                  ? <ScrollText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  : <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                <span className="min-w-0 flex-1 truncate text-sm">{doc.title}</span>
                <span className="shrink-0 text-2xs text-muted-foreground">
                  {formatDate(doc.created_at, language)}
                </span>
              </div>
            ))}
          </Panel>
        </section>
      )}
    </div>
  );
}
