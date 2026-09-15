import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  Home, Ruler, Compass, Eye, FileText, Download, CalendarClock,
  CheckCircle2, Clock, AlertTriangle, Mail, Building2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSurfaceTheme } from '@/hooks/useSurfaceTheme';
import { resolveBuyerRoom, buyerRoomDocumentUrl } from '@/services/developer/share';
import {
  formatMoney, formatArea, formatDate, formatNumber,
} from '@/components/developer/primitives';
import type { BuyerRoomPayload } from '@/services/developer/types';

/**
 * THE BUYER'S ROOM.
 *
 * A person who has reserved or bought an apartment, opening a link on their
 * phone, with no account and nothing to install. They see one thing: their
 * purchase. What they agreed to pay, what they have actually paid, what is
 * due next, and the documents the developer deliberately shared with them.
 *
 * WHAT IS NOT HERE, AND WHY IT CANNOT BE. Everything on this page arrives
 * from ONE call to dev_buyer_room(). The anon role holds no grant on any
 * dev_* table, so there is no query on this path that a mistake in a
 * component could widen. The CRM note about this buyer, the internal
 * documents, the commission owed on their sale and every other buyer in the
 * development are not filtered out here — they are absent from the function's
 * SELECT list.
 *
 * THE MONEY SHOWN IS CONFIRMED MONEY. `paid` sums payments finance has
 * actually confirmed, never ones merely recorded from a receipt. A buyer must
 * never see a balance fall because somebody uploaded a photograph.
 */
export default function BuyerRoomPage() {
  const { token } = useParams<{ token: string }>();
  useSurfaceTheme('light');
  const { t, lang: language } = useLanguage();

  const [payload, setPayload] = useState<BuyerRoomPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    resolveBuyerRoom(token)
      .then((data) => { if (!cancelled) setPayload(data); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  const progress = useMemo(() => {
    const deal = payload?.deal;
    if (!deal || !deal.sale_price) return null;
    const pct = Math.min(100, Math.max(0, (deal.paid / deal.sale_price) * 100));
    return Math.round(pct * 10) / 10;
  }, [payload]);

  async function download(documentId: string, title: string) {
    if (!token) return;
    setDownloading(documentId);
    try {
      const url = await buyerRoomDocumentUrl(token, documentId);
      if (!url) {
        toast.error(t('buyer_room_doc_unavailable'));
        return;
      }
      // The signed URL is short-lived and opening it in a new tab is what a
      // phone browser does best with a PDF.
      window.open(url, '_blank', 'noopener,noreferrer');
    } finally {
      setDownloading(null);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-3xl px-4 pt-24" role="status" aria-live="polite">
          <span className="sr-only">{t('dev_loading')}</span>
          <div className="h-8 w-48 animate-pulse rounded bg-muted" />
          <div className="mt-6 h-40 animate-pulse rounded-lg bg-muted" />
          <div className="mt-4 h-64 animate-pulse rounded-lg bg-muted" />
        </div>
      </div>
    );
  }

  if (!payload || payload.error) {
    const key = payload?.error === 'EXPIRED'
      ? 'buyer_room_expired'
      : payload?.error === 'REVOKED'
        ? 'buyer_room_revoked'
        : 'buyer_room_not_found';
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <Helmet><title>{t('buyer_room_title')}</title></Helmet>
        <div className="max-w-sm text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
          <h1 className="mt-4 text-lg font-semibold">{t(key)}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{t('buyer_room_ask_developer')}</p>
        </div>
      </div>
    );
  }

  const { developer, buyer, deal, reservation, unit, documents, contact } = payload;
  const currency = deal?.currency ?? reservation?.currency ?? 'USD';

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Helmet>
        <title>{`${t('buyer_room_title')}${unit ? ` — ${unit.unit_number}` : ''}`}</title>
        {/* A buyer's private page must never be indexed. */}
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      {/* ── The developer's own header, not ours ─────────────────────────── */}
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4 sm:px-6">
          {developer?.logo_url ? (
            <img
              src={developer.logo_url}
              alt={developer.name}
              className="h-8 w-auto max-w-[140px] object-contain"
            />
          ) : (
            <Building2 className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold tracking-tight">
              {developer?.name ?? ''}
            </p>
            {buyer?.name && (
              <p className="truncate text-xs text-muted-foreground">
                {t('buyer_room_for').replace('{name}', buyer.name)}
              </p>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6">
        {/* ── The apartment ─────────────────────────────────────────────── */}
        {unit && (
          <section className="overflow-hidden rounded-lg border border-border bg-card">
            {unit.photos && unit.photos.length > 0 && (
              <img
                src={unit.photos[0]}
                alt={unit.unit_number}
                className="h-48 w-full object-cover sm:h-64"
                loading="lazy"
              />
            )}
            <div className="p-4 sm:p-5">
              <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-gold-ink">
                {unit.project}
              </p>
              <h1 className="mt-1 text-xl font-semibold tracking-tight">
                {t('buyer_room_unit').replace('{number}', unit.unit_number)}
              </h1>
              {(unit.city || unit.district) && (
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {[unit.district, unit.city].filter(Boolean).join(', ')}
                </p>
              )}

              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                {unit.area_total != null && (
                  <Detail icon={Ruler} label={t('dev_unit_area')} value={formatArea(unit.area_total, language)} />
                )}
                {unit.bedrooms != null && (
                  <Detail icon={Home} label={t('dev_unit_bedrooms')} value={formatNumber(unit.bedrooms, language)} />
                )}
                {unit.floor_level != null && (
                  <Detail icon={Building2} label={t('dev_unit_floor')} value={formatNumber(unit.floor_level, language)} />
                )}
                {unit.orientation && (
                  <Detail icon={Compass} label={t('dev_unit_orientation')} value={unit.orientation} />
                )}
                {unit.view_text && (
                  <Detail icon={Eye} label={t('dev_unit_view')} value={unit.view_text} />
                )}
                {unit.handover_date && (
                  <Detail
                    icon={CalendarClock}
                    label={t('dev_project_handover')}
                    value={formatDate(unit.handover_date, language)}
                  />
                )}
              </dl>

              {unit.floor_plan_url && (
                <a
                  href={unit.floor_plan_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-gold-ink underline underline-offset-4"
                >
                  <FileText className="h-4 w-4" aria-hidden="true" />
                  {t('buyer_room_floor_plan')}
                </a>
              )}
            </div>
          </section>
        )}

        {/* ── A reservation that has not become a contract yet ───────────── */}
        {!deal && reservation && (
          <section className="rounded-lg border border-gold-border/60 bg-gold/[0.05] p-4 sm:p-5">
            <h2 className="text-base font-semibold tracking-tight">{t('buyer_room_reserved_title')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('buyer_room_reserved_body')}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-3">
              <Fact
                label={t('buyer_room_reserved_on')}
                value={formatDate(reservation.reserved_at, language)}
              />
              {reservation.expires_at && (
                <Fact
                  label={t('buyer_room_reserved_until')}
                  value={formatDate(reservation.expires_at, language)}
                />
              )}
              {reservation.amount != null && (
                <Fact
                  label={t('buyer_room_deposit')}
                  value={formatMoney(reservation.amount, reservation.currency, language)}
                />
              )}
            </dl>
          </section>
        )}

        {/* ── The money ─────────────────────────────────────────────────── */}
        {deal && (
          <section className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3 sm:px-5">
              <h2 className="text-base font-semibold tracking-tight">{t('buyer_room_your_purchase')}</h2>
              {deal.contract_number && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t('buyer_room_contract_no').replace('{number}', deal.contract_number)}
                  {deal.contract_date ? ` · ${formatDate(deal.contract_date, language)}` : ''}
                </p>
              )}
            </div>

            <div className="grid gap-4 p-4 sm:grid-cols-3 sm:p-5">
              <Figure label={t('buyer_room_price')} value={formatMoney(deal.sale_price, currency, language)} />
              <Figure
                label={t('buyer_room_paid')}
                value={formatMoney(deal.paid, currency, language)}
                tone="good"
              />
              <Figure
                label={t('buyer_room_outstanding')}
                value={formatMoney(deal.outstanding, currency, language)}
                tone={deal.outstanding > 0 ? 'attention' : 'default'}
              />
            </div>

            {progress !== null && (
              <div className="px-4 pb-4 sm:px-5 sm:pb-5">
                <div
                  className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-valuenow={progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={t('buyer_room_progress')}
                >
                  <div className="h-full rounded-full bg-gold" style={{ width: `${progress}%` }} />
                </div>
                <p className="mt-1.5 text-2xs text-muted-foreground">
                  {t('buyer_room_progress_value').replace('{pct}', formatNumber(progress, language, 1))}
                </p>
              </div>
            )}
          </section>
        )}

        {/* ── The instalment plan ───────────────────────────────────────── */}
        {deal && deal.schedule.length > 0 && (
          <section className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3 sm:px-5">
              <h2 className="text-base font-semibold tracking-tight">{t('buyer_room_schedule')}</h2>
            </div>
            <ul className="divide-y divide-border">
              {deal.schedule.map((row, i) => {
                const overdue = row.status === 'OVERDUE';
                const paid = row.status === 'PAID';
                return (
                  <li key={`${row.label}-${i}`} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                    <span
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                        paid ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                          : overdue ? 'bg-red-500/10 text-red-700 dark:text-red-400'
                            : 'bg-muted text-muted-foreground',
                      )}
                      aria-hidden="true"
                    >
                      {paid ? <CheckCircle2 className="h-4 w-4" />
                        : overdue ? <AlertTriangle className="h-4 w-4" />
                          : <Clock className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{row.label}</p>
                      <p className="text-2xs text-muted-foreground">
                        {row.due_date ? formatDate(row.due_date, language) : t('buyer_room_no_date')}
                        {' · '}
                        {t(
                          paid ? 'dev_pay_paid'
                            : overdue ? 'dev_pay_overdue'
                              : row.status === 'PARTIAL' ? 'dev_pay_partial' : 'dev_pay_pending',
                        )}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-medium tabular">
                      {formatMoney(row.amount, row.currency, language)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* ── What has actually been received ───────────────────────────── */}
        {deal && deal.payments.length > 0 && (
          <section className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3 sm:px-5">
              <h2 className="text-base font-semibold tracking-tight">{t('buyer_room_payments')}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('buyer_room_payments_note')}</p>
            </div>
            <ul className="divide-y divide-border">
              {deal.payments.map((p, i) => (
                <li key={`${p.paid_at}-${i}`} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{formatDate(p.paid_at, language)}</p>
                    {(p.method || p.reference) && (
                      <p className="truncate text-2xs text-muted-foreground">
                        {[p.method, p.reference].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 text-sm font-medium tabular">
                    {formatMoney(p.amount, p.currency, language)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Documents shared deliberately ─────────────────────────────── */}
        {documents && documents.length > 0 && (
          <section className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3 sm:px-5">
              <h2 className="text-base font-semibold tracking-tight">{t('buyer_room_documents')}</h2>
            </div>
            <ul className="divide-y divide-border">
              {documents.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{d.title}</p>
                    <p className="text-2xs text-muted-foreground">
                      {formatDate(d.created_at, language)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    disabled={downloading === d.id}
                    onClick={() => void download(d.id, d.title)}
                  >
                    <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    {downloading === d.id ? t('buyer_room_opening') : t('buyer_room_open')}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Who to ask ────────────────────────────────────────────────── */}
        {contact?.name && (
          <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
            <h2 className="text-sm font-semibold tracking-tight">{t('buyer_room_your_contact')}</h2>
            <p className="mt-1 text-sm">{contact.name}</p>
            {contact.email && (
              <a
                href={`mailto:${contact.email}`}
                className="mt-1 inline-flex items-center gap-1.5 text-sm text-gold-ink underline underline-offset-4"
              >
                <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                {contact.email}
              </a>
            )}
          </section>
        )}

        <p className="pt-2 text-center text-2xs text-muted-foreground">
          {t('buyer_room_footer')}
        </p>
      </main>
    </div>
  );
}

function Detail({
  icon: Icon, label, value,
}: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-2xs uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-sm font-medium">{value}</dd>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium">{value}</dd>
    </div>
  );
}

function Figure({
  label, value, tone = 'default',
}: { label: string; value: React.ReactNode; tone?: 'default' | 'good' | 'attention' }) {
  return (
    <div className="relative min-w-0">
      {tone === 'good' && (
        <span aria-hidden="true" className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-emerald-500" />
      )}
      {tone === 'attention' && (
        <span aria-hidden="true" className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-amber-500" />
      )}
      <p className={cn('text-xs text-muted-foreground', tone !== 'default' && 'pl-3')}>{label}</p>
      <p className={cn('mt-0.5 text-lg font-semibold tabular tracking-tight', tone !== 'default' && 'pl-3')}>
        {value}
      </p>
    </div>
  );
}
