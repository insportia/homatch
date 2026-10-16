/*
 * HOMATCH Verify — the deterministic intelligence cards.
 *
 *   PropertyRegisterCard  what the unit's own NAPR extract says (owner,
 *                         mortgages, liens, construction state) and every
 *                         registry proceeding on it — parsed, never guessed
 *   CompanyFinanceCard    the developer's financial position from what was
 *                         actually checked, each with its date
 *   MarketContextCard     the market range HOMATCH already held for this
 *                         segment, dated, as asking prices
 *   ReportNav             the sticky five-group navigation of the report
 *
 * CUSTOMER-FIRST. Each card leads with what HOMATCH found. Uncertainty is
 * named specifically and calmly („დამატებით დასაზუსტებელია“); strong colour
 * is used only for a concern a document actually states. No provider names,
 * states or codes appear here — those stay in Admin.
 */
import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { kindT } from '@/verify/intelligence/kindGuard';
import { VerifySection, Row, RowList, StatusPill } from './ui';
import type { PropertyRegister, RegisterMortgage, RegisterState, ProceedingKind } from '@/verify/intelligence/propertyRegister';
import type { CompanyFinanceView, MarketContextView, ProjectTeamMember } from '@/verify/intelligence/reportGaps';
import { registerView, type RegisterSourceLike } from '@/verify/reportPresentation';
import { rsTaxCardModel } from '@/verify/rsTaxpayer';

/** First-strong isolates keep a date or number in reading order inside RTL text. */
const iso = (s: string): string => `⁦${s}⁩`;
const dmy = (v?: string | null): string | null => {
  const m = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(v) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
};
const creditorName = (c?: string | null): string => {
  const v = String(c ?? '').trim();
  return v.match(/["„“]([^"„“”]+)["“”]/)?.[1]?.trim() || v.replace(/\s+\d{9}$/, '');
};
const money = (n: number, lang: string): string => {
  try {
    return new Intl.NumberFormat(lang === 'ka' ? 'ka-GE' : lang, { maximumFractionDigits: 0 }).format(n);
  } catch {
    return String(Math.round(n));
  }
};

/* ───────────────────────── Property register ───────────────────────── */

const PROC_KEYS: Record<ProceedingKind, string> = {
  OWNERSHIP_TRANSFER: 'vbi_proc_ownership_transfer',
  PARTNERSHIP_OWNERSHIP: 'vbi_proc_partnership_ownership',
  MORTGAGE_CREATED: 'vbi_proc_mortgage_created',
  MORTGAGE_TERMINATED: 'vbi_proc_mortgage_terminated',
  OTHER: 'vbi_proc_other',
};

function StateValue({ state }: { state: RegisterState }) {
  const { t } = useLanguage();
  if (state === 'NONE') return <StatusPill tone="confirmed">{t('vbi_reg_not_registered')}</StatusPill>;
  if (state === 'REGISTERED') return <StatusPill tone="risk">{t('vbi_reg_registered')}</StatusPill>;
  return null;
}

function MortgageLine({ m }: { m: RegisterMortgage }) {
  const { t } = useLanguage();
  const parts = [
    creditorName(m.creditor),
    dmy(m.registeredOn) ? t('vbi_reg_registered_on', { date: iso(dmy(m.registeredOn)!) }) : null,
    m.agreementNumber ? t('vbi_reg_agreement', { number: iso(m.agreementNumber) }) : null,
  ].filter(Boolean);
  return <span className="break-words">{parts.join(' · ')}</span>;
}

/* `kind`: the registry kind (kindGuard.copyKindOf); the apartment copy is unchanged without it. */
export function PropertyRegisterCard({ register, source, kind }: { register?: PropertyRegister | null; source?: RegisterSourceLike | null; kind?: string }) {
  const { t } = useLanguage();
  const latest = register?.latest;
  const view = registerView(register, source);
  if (!register || !latest || !view) return null;
  const asOf = dmy(latest.issuedAt);
  // Names only, as the public extract prints them; registerView strips any
  // personal number that travelled with a name.
  const ownerText = view.owners.length
    ? view.owners.map((o) => o.name).join(', ')
    : (latest.owners ?? []).some((o) => o.kind === 'PERSON') ? t('vbi_reg_owner_person') : '';
  const since = dmy(latest.ownershipRegisteredOn);
  const proceedings = (register.proceedings ?? []).slice(-12);

  return (
    <VerifySection
      id="vbi-register"
      eyebrow={t('vbi_reg_eyebrow')}
      title={t('vbi_reg_title')}
      subtitle={asOf ? t('vbi_reg_subtitle', { date: iso(asOf) }) : undefined}
      accent
    >
      <RowList>
        {ownerText ? (
          <Row label={t('vbi_reg_owner')}>
            <span className="font-medium">
              {/* As the public extract names them (owner, 2026-10-10). */}
              {ownerText}
            </span>
            {since ? (
              <span className="block text-xs text-muted-foreground">
                {t(latest.ownershipBasis === 'PURCHASE' ? 'vbi_reg_owner_since_purchase' : 'vbi_reg_owner_since', { date: iso(since) })}
              </span>
            ) : null}
          </Row>
        ) : null}

        <Row label={kindT(t, 'verify_v3_reg_unit_mortgage', kind)}>
          {view.unitMortgages.length ? (
            <div className="space-y-2">
              <StatusPill tone="attention">{t('vbi_reg_mortgage_pill', { count: String(view.unitMortgages.length) })}</StatusPill>
              <ul className="space-y-1">
                {(view.unitMortgages as RegisterMortgage[]).map((m, i) => (
                  <li key={`${m.agreementNumber}-${i}`}><MortgageLine m={m} /></li>
                ))}
              </ul>
              <p className="text-xs leading-5 text-muted-foreground">{t('vbi_reg_mortgage_note')}</p>
            </div>
          ) : (
            <StatusPill tone="confirmed">{t('vbi_reg_not_registered')}</StatusPill>
          )}
          {register.removedMortgages.length ? (
            <ul className="mt-2 space-y-1">
              {register.removedMortgages.map((m, i) => (
                <li key={`rm-${i}`} className="text-xs leading-5 text-muted-foreground break-words">
                  {m.removedBy?.decisionDate
                    ? t('vbi_reg_removed', { creditor: creditorName(m.creditor), agreementDate: iso(dmy(m.agreementDate) ?? '—'), date: iso(dmy(m.removedBy.decisionDate)!) })
                    : t('vbi_reg_removed_plain', { creditor: creditorName(m.creditor), agreementDate: iso(dmy(m.agreementDate) ?? '—'), date: iso(asOf ?? '—') })}
                </li>
              ))}
            </ul>
          ) : null}
        </Row>

        {/* Security on the developer's parcel or building — distinct from a
            mortgage on the apartment itself, and said only when the extract
            is the parcel's or the record marks it so. */}
        {view.parcelMortgages.length ? (
          <Row label={t('verify_v3_reg_parcel_security')}>
            <div className="space-y-2">
              <StatusPill tone="attention">{t('vbi_reg_mortgage_pill', { count: String(view.parcelMortgages.length) })}</StatusPill>
              <ul className="space-y-1">
                {(view.parcelMortgages as RegisterMortgage[]).map((m, i) => (
                  <li key={`pm-${i}`}><MortgageLine m={m} /></li>
                ))}
              </ul>
              <p className="text-xs leading-5 text-muted-foreground">{kindT(t, 'verify_v3_reg_parcel_security_note', kind)}</p>
            </div>
          </Row>
        ) : null}

        {latest.taxLien !== 'UNKNOWN' ? <Row label={t('vbi_reg_tax_lien')}><StateValue state={latest.taxLien} /></Row> : null}
        {latest.seizure !== 'UNKNOWN' ? <Row label={t('vbi_reg_seizure')}><StateValue state={latest.seizure} /></Row> : null}
        {latest.debtorRegistry !== 'UNKNOWN' ? <Row label={t('vbi_reg_debtor')}><StateValue state={latest.debtorRegistry} /></Row> : null}

        {latest.buildingsUnderConstruction || latest.unitUnderConstruction ? (
          <Row label={t('vbi_reg_construction')}>
            <span className="break-words">{t('vbi_reg_under_construction')}</span>
            <span className="block text-xs text-muted-foreground">{t('vbi_reg_under_construction_note')}</span>
          </Row>
        ) : null}

        {latest.landFunction ? (
          <Row label={t('vbi_reg_land_function')}>
            <span dir="auto" className="break-words">{latest.landFunction}</span>
          </Row>
        ) : null}
      </RowList>

      {proceedings.length ? (
        <div className="mt-5 space-y-2 border-t border-border pt-4">
          <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('vbi_reg_history')}</p>
          <p className="text-xs leading-5 text-muted-foreground">
            {t('vbi_reg_coverage', { found: String(register.coverage.found), read: String(register.coverage.read) })}
          </p>
          <ol className="space-y-1.5">
            {proceedings.map((p) => (
              <li key={p.applicationNumber} className="grid grid-cols-[6.5rem_1fr] gap-3 text-sm">
                <bdi dir="ltr" className="whitespace-nowrap tabular-nums text-muted-foreground">{dmy(p.completedOn ?? p.filedOn) ?? '—'}</bdi>
                <span className="min-w-0 break-words">
                  {t(PROC_KEYS[p.kind] ?? 'vbi_proc_other')}
                  {!p.read ? <span className="ms-2 text-2xs text-muted-foreground">· {t('vbi_proc_listed')}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {view.disclosure ? (
        <p className="mt-4 rounded-xl bg-muted/60 px-3 py-2 text-xs leading-5 text-foreground/80 break-words" data-register-reused>
          {t('verify_v3_reg_reused', { date: iso(dmy(view.disclosure.date)!) })}
        </p>
      ) : asOf ? <p className="mt-4 text-xs leading-5 text-muted-foreground break-words">{t('vbi_reg_fresh', { date: iso(asOf) })}</p> : null}
    </VerifySection>
  );
}

/* ───────────────────────── Company finance ───────────────────────── */

export function CompanyFinanceCard({ finance }: { finance?: CompanyFinanceView | null }) {
  const { t } = useLanguage();
  if (!finance) return null;
  const extract = dmy(finance.registryExtractDate);
  return (
    <VerifySection
      id="vbi-finance"
      eyebrow={t('vbi_fin_eyebrow')}
      title={finance.companyName ?? t('vbi_fin_title')}
      subtitle={t('vbi_fin_subtitle')}
    >
      <RowList>
        {finance.debtorRegistry ? (
          <Row label={t('vbi_fin_debtor')}>
            <StatusPill tone={finance.debtorRegistry.state === 'NO_ENTRY' ? 'confirmed' : 'risk'}>
              {t(finance.debtorRegistry.state === 'NO_ENTRY' ? 'vbi_fin_debtor_none' : 'vbi_fin_debtor_listed')}
            </StatusPill>
            {finance.debtorRegistry.state === 'NO_ENTRY' ? (
              <span className="block mt-1.5 text-sm leading-6 text-foreground/80 break-words">{t('vbi_fin_debtor_none_explain')}</span>
            ) : null}
            {dmy(finance.debtorRegistry.checkedOn) ? (
              <span className="block mt-1 text-xs text-muted-foreground">{t('vbi_fin_checked', { date: iso(dmy(finance.debtorRegistry.checkedOn)!) })}</span>
            ) : null}
          </Row>
        ) : null}

        {finance.pledges.length ? (
          <Row label={t('vbi_fin_pledge')}>
            <ul className="space-y-1">
              {finance.pledges.map((p, i) => (
                <li key={i} className="break-words">
                  {[creditorName(p.creditor), p.reference ? iso(p.reference) : null, dmy(p.registeredOn) ? iso(dmy(p.registeredOn)!) : null].filter(Boolean).join(' · ')}
                </li>
              ))}
            </ul>
            <span className="block mt-1.5 text-sm leading-6 text-foreground/80 break-words">{t('vbi_fin_pledge_explain')}</span>
          </Row>
        ) : null}

        {finance.liquidationRegistered === false ? (
          <Row label={t('vbi_fin_liquidation')}>
            <StatusPill tone="confirmed">{t('vbi_fin_liquidation_none')}</StatusPill>
            <span className="block mt-1.5 text-sm leading-6 text-foreground/80 break-words">{t('vbi_fin_liquidation_none_explain')}</span>
          </Row>
        ) : finance.liquidationRegistered === true ? (
          <Row label={t('vbi_fin_liquidation')}><StatusPill tone="risk">{t('vbi_fin_liquidation_registered')}</StatusPill></Row>
        ) : null}

        {/* RS.ge: only what its taxpayer registry literally returned, with the
            check date and where to repeat it. A check that did not complete
            reads neutrally — never positive, never adverse. */}
        <TaxpayerRow finance={finance} />

        {finance.financingPartner ? (
          <Row label={t('vbi_fin_financing')}>
            <span dir="auto" className="break-words">{finance.financingPartner}</span>
            <span className="block text-xs text-muted-foreground">{t('vbi_fin_public_statement')}</span>
          </Row>
        ) : null}
      </RowList>
      {extract ? <p className="mt-4 text-xs text-muted-foreground">{t('vbi_fin_extract_date', { date: iso(extract) })}</p> : null}
    </VerifySection>
  );
}

/** RS.ge's own column name, readable: "TaxPayerType" → "Tax payer type"; Georgian labels stay as given. */
const rsLabel = (l: string): string =>
  /^[A-Za-z0-9_]+$/.test(l)
    ? l.replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim().replace(/^./, (c) => c.toUpperCase()).replace(/(?<=\s)[A-Z](?=[a-z])/g, (c) => c.toLowerCase())
    : l;

function TaxpayerRow({ finance }: { finance: CompanyFinanceView }) {
  const { t } = useLanguage();
  const model = rsTaxCardModel(finance.taxStatus, finance.companyId);
  if (!model) return null;
  const checked = dmy(model.checkedOn);
  return (
    <Row label={t('vbi_fin_tax')}>
      <StatusPill tone={model.pill.tone}>{model.pill.text ? <span dir="auto">{model.pill.text}</span> : t(model.pill.key!)}</StatusPill>
      {model.cautionKey ? (
        <span className="block mt-1.5 text-sm leading-6 text-[hsl(var(--gold-ink))] break-words">{t(model.cautionKey)}</span>
      ) : null}
      {model.rows.length ? (
        <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
          {model.rows.map((r, i) => (
            <div key={i} className="contents">
              <dt className="text-xs text-muted-foreground break-words" dir="auto">{r.labelKey ? t(r.labelKey) : rsLabel(r.label ?? '')}</dt>
              <dd className="text-sm text-foreground break-words" dir="auto">
                {r.yesNo === true ? t('vbi_rs_yes') : r.yesNo === false ? t('vbi_rs_no') : r.isDate ? iso(dmy(r.value) ?? r.value) : r.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <span className="block mt-1.5 text-sm leading-6 text-foreground/80 break-words">{t(model.explainKey, model.explainVars)}</span>
      <span className="block mt-1 text-xs text-muted-foreground">
        {checked ? <>{t('vbi_fin_tax_checked', { date: iso(checked) })} · </> : null}
        <a href={model.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">
          {t('vbi_rs_source_link')}
        </a>
      </span>
    </Row>
  );
}

/* ───────────────────────── Market context ───────────────────────── */

const SCOPE_KEY: Record<string, string> = {
  PROJECT: 'vbi_mkt_scope_project',
  STREET: 'vbi_mkt_scope_street',
  DISTRICT: 'vbi_mkt_scope_district',
  CITY: 'vbi_mkt_scope_city',
};

export function MarketContextCard({ market }: { market?: MarketContextView | null }) {
  const { t, lang } = useLanguage();
  if (!market || !(market.medianPerSqm > 0)) return null;
  const cur = market.currency;
  const lo = market.lowerPerSqm;
  const hi = market.upperPerSqm;
  const pos = lo !== null && hi !== null && hi > lo ? Math.min(100, Math.max(0, ((market.medianPerSqm - lo) / (hi - lo)) * 100)) : null;
  const asOf = dmy(market.asOf);
  return (
    <VerifySection
      id="vbi-market"
      eyebrow={t('vbi_mkt_eyebrow')}
      title={t('vbi_mkt_title', { scope: t(SCOPE_KEY[market.scope] ?? 'vbi_mkt_scope_district') })}
      subtitle={t('vbi_mkt_subtitle', { count: String(market.listings) })}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('vbi_mkt_median')}</p>
          <p className="mt-1.5 font-display text-2xl font-semibold text-[hsl(var(--gold-ink))]">
            <bdi dir="ltr">{money(market.medianPerSqm, lang)} {cur}/m²</bdi>
          </p>
        </div>
        {lo !== null && hi !== null ? (
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('vbi_mkt_range')}</p>
            <p className="mt-1.5 text-lg font-semibold"><bdi dir="ltr">{money(lo, lang)} – {money(hi, lang)} {cur}/m²</bdi></p>
          </div>
        ) : null}
      </div>
      {pos !== null ? (
        <div className="mt-4" aria-hidden="true">
          <div className="relative h-2 rounded-full bg-muted">
            <span className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-[hsl(var(--gold-ink))] ring-2 ring-background" style={{ insetInlineStart: `calc(${pos}% - 7px)` }} />
          </div>
        </div>
      ) : null}
      <div className="mt-4 space-y-1.5 text-xs leading-5 text-muted-foreground">
        {asOf ? <p>{t('vbi_mkt_as_of', { date: iso(asOf) })}</p> : null}
        {market.listings <= 3 ? <p>{t('vbi_mkt_thin')}</p> : null}
        <p>{t('vbi_mkt_note')}</p>
      </div>
    </VerifySection>
  );
}

/* ───────────────────────── Navigation ───────────────────────── */

/*
 * THE REPORT'S NAVIGATION: five groups, sticky under the app header (v6).
 *
 * - The bar sits just below whichever sticky header the shell draws (its
 *   height is measured, not guessed: 56, 64 or 80px), so it never covers it.
 * - It publishes --vbi-offset (header + bar + breathing room) on <html>; every
 *   group and chapter uses it as scroll-margin, so a jump lands with its
 *   heading visible instead of under the bar.
 * - The active group is the last one whose top has passed that offset,
 *   recomputed on IntersectionObserver changes and scroll (rAF-throttled).
 * - On a phone the pills scroll horizontally and the active one is kept in
 *   view; the page itself never scrolls sideways.
 * - A jump re-aligns once when a lazily mounted section above the target
 *   changed the page's height on the way.
 */
export function ReportNav({ items }: { items: Array<{ id: string; labelKey: string }> }) {
  const { t } = useLanguage();
  const [current, setCurrent] = useState<string | null>(items[0]?.id ?? null);
  const [top, setTop] = useState<number | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const ids = items.map((i) => i.id).join('|');

  // Where the bar sticks, and how far below it a jump should land.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const measure = () => {
      const header = [...document.querySelectorAll('header')].find((h) => {
        const cs = getComputedStyle(h);
        return (cs.position === 'sticky' || cs.position === 'fixed') && h.getBoundingClientRect().top <= 1 && h.offsetHeight > 0 && h.offsetHeight < 160;
      });
      const headerH = header ? Math.round(header.getBoundingClientRect().height) : 0;
      const barH = navRef.current ? Math.round(navRef.current.getBoundingClientRect().height) : 52;
      setTop(headerH);
      document.documentElement.style.setProperty('--vbi-offset', `${headerH + barH + 16}px`);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      document.documentElement.style.removeProperty('--vbi-offset');
    };
  }, [ids]);

  // Which group the reader is in.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const els = ids.split('|').map((id) => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
    if (!els.length) return;
    let frame = 0;
    const offset = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--vbi-offset')) || 128;
    const recompute = () => {
      frame = 0;
      const line = offset() + 8;
      let active = els[0].id;
      for (const el of els) if (el.getBoundingClientRect().top <= line) active = el.id;
      // At the very bottom the last group is the one being read.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) active = els[els.length - 1].id;
      setCurrent((c) => (c === active ? c : active));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(recompute); };
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(schedule, { threshold: [0, 0.25, 0.5, 0.75, 1] });
      els.forEach((e) => io!.observe(e));
    }
    window.addEventListener('scroll', schedule, { passive: true });
    recompute();
    return () => {
      io?.disconnect();
      window.removeEventListener('scroll', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ids]);

  // Keep the active pill visible inside the horizontally scrolling bar.
  useEffect(() => {
    const list = listRef.current;
    const pill = current ? list?.querySelector<HTMLElement>(`[data-nav-target="${current}"]`) : null;
    if (!list || !pill || list.scrollWidth <= list.clientWidth) return;
    // Relative geometry, so it holds in RTL too (where scrollLeft runs negative).
    const lb = list.getBoundingClientRect();
    const pb = pill.getBoundingClientRect();
    if (pb.left < lb.left) list.scrollBy({ left: pb.left - lb.left - 16 });
    else if (pb.right > lb.right) list.scrollBy({ left: pb.right - lb.right + 16 });
  }, [current]);

  const jump = (e: ReactMouseEvent<HTMLAnchorElement>, id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    try { history.replaceState(history.state, '', `#${id}`); } catch { /* sandboxed */ }
    setCurrent(id);
    // Lazily mounted sections above the target can move it while we travel
    // (and just after we arrive): re-align a few times, unless the reader
    // takes over the scrolling.
    let cancelled = false;
    const stop = () => { cancelled = true; };
    const opts = { once: true, passive: true } as const;
    window.addEventListener('wheel', stop, opts);
    window.addEventListener('touchstart', stop, opts);
    window.addEventListener('keydown', stop, { once: true });
    const settle = () => {
      if (cancelled) return;
      const off = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--vbi-offset')) || 128;
      const drift = el.getBoundingClientRect().top - off;
      if (Math.abs(drift) > 12) window.scrollBy({ top: drift, behavior: 'auto' });
    };
    for (const ms of reduce ? [60, 250, 600, 1100] : [750, 1100, 1600]) window.setTimeout(settle, ms);
    window.setTimeout(() => {
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchstart', stop);
      window.removeEventListener('keydown', stop);
    }, 1700);
  };

  if (items.length < 2) return null;
  return (
    <nav
      ref={navRef}
      aria-label={t('verify_v6_nav_label')}
      data-report-nav=""
      className="sticky top-16 z-20 -mx-1 min-w-0 rounded-2xl border border-border/80 bg-background/95 px-1 py-1 shadow-[0_8px_24px_-18px_hsl(222_47%_11%/0.45)] backdrop-blur-md supports-[backdrop-filter]:bg-background/85 md:top-20"
      style={top !== null ? { top } : undefined}
    >
      <ul ref={listRef} className="flex gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((i) => {
          const on = current === i.id;
          return (
            <li key={i.id} className="shrink-0">
              <a
                href={`#${i.id}`}
                data-nav-target={i.id}
                onClick={(e) => jump(e, i.id)}
                aria-current={on ? 'location' : undefined}
                className={`inline-flex min-h-[44px] items-center whitespace-nowrap rounded-xl px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-ink))] motion-reduce:transition-none ${
                  on
                    ? 'bg-[hsl(222_47%_11%)] text-white shadow-[inset_0_-2px_0_hsl(38_92%_56%)]'
                    : 'text-foreground/80 hover:bg-muted hover:text-foreground'
                }`}
              >
                {t(i.labelKey)}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/* ───────────────────────── Executive glance ───────────────────────── */

type Tone = 'confirmed' | 'attention' | 'risk' | 'quiet';
// `!`: the report's blanket `.verify-report [class*='border-border']` rule
// (index.css, specificity 0,2,0) otherwise repaints the accent edge neutral.
const TILE_TONE: Record<Tone, string> = {
  confirmed: '!border-s-emerald-600/70',
  attention: '!border-s-[hsl(var(--gold-border))]',
  risk: '!border-s-destructive/70',
  quiet: 'border-s-border',
};

/*
 * THE DECISION IN FOUR FACTS.
 *
 * Directly under the verdict: who owns it, what is registered against it,
 * how the developer stands, and where the market is — each a deterministic
 * fact with a link to the section that explains it. Strong colour only for
 * what a document actually states; an unchecked point stays neutral.
 */
export function ExecutiveGlance({
  register,
  finance,
  market,
}: {
  register?: PropertyRegister | null;
  finance?: CompanyFinanceView | null;
  market?: MarketContextView | null;
}) {
  const { t, lang } = useLanguage();
  const tiles: Array<{ key: string; label: string; value: string; note?: string; tone: Tone; href: string }> = [];
  const latest = register?.latest;
  if (latest) {
    const asOf = dmy(latest.issuedAt);
    const owners = latest.owners ?? [];
    if (owners.length) {
      tiles.push({
        key: 'owner',
        label: t('vbi_glance_owner'),
        value: owners.map((o) => o.name ?? (o.kind === 'PERSON' ? t('vbi_reg_owner_person') : '')).filter(Boolean).join(', '),
        note: dmy(latest.ownershipRegisteredOn) ? t('vbi_reg_owner_since', { date: iso(dmy(latest.ownershipRegisteredOn)!) }) : undefined,
        tone: 'quiet',
        href: '#vbi-register',
      });
    }
    const m = register!.currentMortgages;
    tiles.push({
      key: 'mortgage',
      label: t('vbi_reg_mortgage'),
      value: m.length ? t('vbi_reg_mortgage_pill', { count: String(m.length) }) : t('vbi_reg_not_registered'),
      note: m.length ? creditorName(m[0].creditor) : asOf ? t('vbi_glance_as_of', { date: iso(asOf) }) : undefined,
      tone: m.length ? 'attention' : 'confirmed',
      href: '#vbi-register',
    });
    const states = [latest.taxLien, latest.seizure, latest.debtorRegistry];
    if (states.some((s) => s === 'REGISTERED')) {
      tiles.push({ key: 'restrictions', label: t('vbi_glance_restrictions'), value: t('vbi_reg_registered'), tone: 'risk', href: '#vbi-register' });
    } else if (states.every((s) => s === 'NONE')) {
      tiles.push({ key: 'restrictions', label: t('vbi_glance_restrictions'), value: t('vbi_glance_restrictions_none'), tone: 'confirmed', href: '#vbi-register' });
    }
  }
  if (finance?.debtorRegistry) {
    tiles.push({
      key: 'developer',
      label: t('vbi_glance_developer'),
      value: t(finance.debtorRegistry.state === 'NO_ENTRY' ? 'vbi_fin_debtor_none' : 'vbi_fin_debtor_listed'),
      tone: finance.debtorRegistry.state === 'NO_ENTRY' ? 'confirmed' : 'risk',
      href: '#vbi-finance',
    });
  }
  if (market && market.medianPerSqm > 0) {
    tiles.push({
      key: 'market',
      label: t('vbi_mkt_median'),
      value: `${money(market.medianPerSqm, lang)} ${market.currency}/m²`,
      note: t('vbi_mkt_subtitle', { count: String(market.listings) }),
      tone: 'quiet',
      href: '#vbi-market',
    });
  }
  if (tiles.length < 2) return null;
  return (
    <section aria-labelledby="vbi-glance" className="space-y-3">
      <h2 id="vbi-glance" className="text-2xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--gold-ink))]">
        {t('vbi_glance_title')}
      </h2>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {tiles.map((tile) => (
          <li key={tile.key} className="min-w-0 sm:[&:last-child:nth-child(odd)]:col-span-2">
            <a
              href={tile.href}
              className={`block h-full min-w-0 rounded-xl border border-border border-s-[3px] ${TILE_TONE[tile.tone]} bg-card px-4 py-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-ink))] motion-reduce:transition-none`}
            >
              <span className="block text-2xs uppercase tracking-wide text-muted-foreground break-words">{tile.label}</span>
              <span className="mt-1 block text-sm font-semibold text-foreground break-words" dir="auto">{tile.value}</span>
              {tile.note ? <span className="mt-0.5 block text-xs text-muted-foreground break-words" dir="auto">{tile.note}</span> : null}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}


/* ───────────────────────── Project team ───────────────────────── */

export const TEAM_ROLE_KEY: Record<string, string> = {
  ARCHITECT: 'vbi_team_role_architect', CO_ARCHITECT: 'vbi_team_role_co_architect', STRUCTURAL_ENGINEER: 'vbi_team_role_structural',
  GEOTECHNICAL_SPECIALIST: 'vbi_team_role_geotechnical', EXPERT_REVIEW: 'vbi_team_role_expert', TECHNICAL_SUPERVISOR: 'vbi_team_role_supervisor',
  CONTRACTOR: 'vbi_team_role_contractor', MEP_ENGINEER: 'vbi_team_role_mep', LANDSCAPE_ARCHITECT: 'vbi_team_role_landscape',
  FIRE_SAFETY: 'vbi_team_role_fire', SURVEYOR: 'vbi_team_role_surveyor', INTERIOR_DESIGNER: 'vbi_team_role_interior', DEVELOPER: 'vbi_team_role_developer',
};

/** Who designed, engineered and built the project — official names first. */
export function ProjectTeamCard({ team }: { team?: ProjectTeamMember[] | null }) {
  const { t } = useLanguage();
  const list = (team ?? []).filter((m) => m.name);
  if (!list.length) return null;
  return (
    <VerifySection id="vbi-team" eyebrow={t('vbi_team_eyebrow')} title={t('vbi_team_title')} subtitle={t('vbi_team_subtitle')}>
      <RowList>
        {list.map((m) => (
          <Row
            key={m.name}
            label={m.roles.map((r) => (TEAM_ROLE_KEY[r] ? t(TEAM_ROLE_KEY[r]) : m.roleText || t('vbi_team_role_other'))).join(' · ')}
          >
            <span className="font-medium break-words" dir="auto">{m.name}</span>
            {m.basis === 'OFFICIAL' ? <span className="block text-xs text-muted-foreground">{t('vbi_team_official')}</span> : null}
          </Row>
        ))}
      </RowList>
    </VerifySection>
  );
}

/* ───────────────────────── How much was read ───────────────────────── */

/*
 * THE SCALE OF THE WORK, AT THE TOP (owner, 2026-10-10: "19 checked" read as
 * if we had looked at little — the run reads hundreds of pages). Every figure
 * is a count the run itself recorded; nothing is estimated.
 */
export function ResearchScaleBanner({
  coverage,
  register,
  adsSeen,
  sources,
}: {
  coverage?: { officialPagesRead?: number; officialCasesReviewed?: number; officialAttachmentsRead?: number; officialStepsReviewed?: number; marketListingsAnalyzed?: number } | null;
  register?: { documents?: number; found?: number } | null;
  adsSeen?: number | null;
  sources?: number | null;
}) {
  const { t } = useLanguage();
  const items: Array<{ key: string; n: number }> = [];
  const add = (key: string, n?: number | null) => {
    if (n && n > 0) items.push({ key, n });
  };
  add('vbi_scale_cases', coverage?.officialCasesReviewed);
  add('vbi_scale_documents', (coverage?.officialAttachmentsRead ?? 0) + (register?.documents ?? 0));
  add('vbi_scale_steps', coverage?.officialStepsReviewed);
  add('vbi_scale_registry', register?.found);
  add('vbi_scale_listings', coverage?.marketListingsAnalyzed);
  add('vbi_scale_ads', adsSeen);
  add('vbi_scale_sources', sources);
  const total = items.reduce((a, b) => a + b.n, 0);
  if (total < 1 || items.length < 2) return null;
  // Pages are a different unit — told in the headline, never added to the count.
  const pages = coverage?.officialPagesRead && coverage.officialPagesRead > 0 ? coverage.officialPagesRead : 0;
  return (
    <section aria-label={t('vbi_scale_title')} className="rounded-2xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))]/40 p-5 space-y-3">
      <p className="text-2xs uppercase tracking-wider text-[hsl(var(--gold-ink))]">{t('vbi_scale_title')}</p>
      <p className="text-lg font-semibold leading-snug break-words">{pages ? t('vbi_scale_headline_pages', { pages: iso(String(pages)), count: iso(String(total)) }) : t('vbi_scale_headline', { count: iso(String(total)) })}</p>
      <dl className="flex flex-wrap gap-2">
        {items.map((i) => (
          <div key={i.key} className="min-w-0 rounded-full border border-border bg-card px-3 py-1.5 text-xs">
            <dt className="inline text-muted-foreground">{t(i.key)}: </dt>
            <dd className="inline font-semibold tabular-nums">{iso(String(i.n))}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
