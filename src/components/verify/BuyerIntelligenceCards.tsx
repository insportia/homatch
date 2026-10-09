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
 *   ReportNav             jump links to the sections this report has
 *
 * CUSTOMER-FIRST. Each card leads with what HOMATCH found. Uncertainty is
 * named specifically and calmly („დამატებით დასაზუსტებელია“); strong colour
 * is used only for a concern a document actually states. No provider names,
 * states or codes appear here — those stay in Admin.
 */
import { useLanguage } from '@/contexts/LanguageContext';
import { VerifySection, Row, RowList, StatusPill } from './ui';
import type { PropertyRegister, RegisterMortgage, RegisterState, ProceedingKind } from '@/verify/intelligence/propertyRegister';
import type { CompanyFinanceView, MarketContextView } from '@/verify/intelligence/reportGaps';

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

export function PropertyRegisterCard({ register }: { register?: PropertyRegister | null }) {
  const { t } = useLanguage();
  const latest = register?.latest;
  if (!register || !latest) return null;
  const asOf = dmy(latest.issuedAt);
  const owners = latest.owners ?? [];
  const privateOwner = owners.length > 0 && owners.every((o) => o.kind === 'PERSON');
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
        {owners.length ? (
          <Row label={t('vbi_reg_owner')}>
            <span className="font-medium">
              {privateOwner
                ? t(owners.length > 1 ? 'vbi_reg_owner_persons' : 'vbi_reg_owner_person')
                : owners.map((o) => (o.kind === 'COMPANY' ? o.name : t('vbi_reg_owner_person'))).filter(Boolean).join(', ')}
            </span>
            {since ? (
              <span className="block text-xs text-muted-foreground">
                {t(latest.ownershipBasis === 'PURCHASE' ? 'vbi_reg_owner_since_purchase' : 'vbi_reg_owner_since', { date: iso(since) })}
              </span>
            ) : null}
          </Row>
        ) : null}

        <Row label={t('vbi_reg_mortgage')}>
          {register.currentMortgages.length ? (
            <div className="space-y-2">
              <StatusPill tone="attention">{t('vbi_reg_mortgage_pill', { count: String(register.currentMortgages.length) })}</StatusPill>
              <ul className="space-y-1">
                {register.currentMortgages.map((m, i) => (
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

      {asOf ? <p className="mt-4 text-xs leading-5 text-muted-foreground break-words">{t('vbi_reg_fresh', { date: iso(asOf) })}</p> : null}
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
            <span className="block mt-1 text-xs leading-5 text-muted-foreground">{t('vbi_fin_pledge_note')}</span>
          </Row>
        ) : null}

        {finance.liquidationRegistered === false ? (
          <Row label={t('vbi_fin_liquidation')}><StatusPill tone="confirmed">{t('vbi_fin_liquidation_none')}</StatusPill></Row>
        ) : finance.liquidationRegistered === true ? (
          <Row label={t('vbi_fin_liquidation')}><StatusPill tone="risk">{t('vbi_fin_liquidation_registered')}</StatusPill></Row>
        ) : null}

        <Row label={t('vbi_fin_tax')}>
          {finance.taxStatus.state === 'CHECKED' ? (
            <span>{t('vbi_fin_tax_checked', { date: iso(dmy(finance.taxStatus.checkedOn) ?? '—') })}</span>
          ) : (
            <>
              <StatusPill tone="quiet">{t('vbi_followup')}</StatusPill>
              <span className="block mt-1 text-xs leading-5 text-muted-foreground break-words">
                {t('vbi_fin_tax_help', { id: iso(finance.companyId ?? '—') })}
              </span>
            </>
          )}
        </Row>

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

export function ReportNav({ items }: { items: Array<{ id: string; labelKey: string }> }) {
  const { t } = useLanguage();
  if (items.length < 3) return null;
  return (
    <nav aria-label={t('vbi_nav_label')} className="min-w-0">
      <ul className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {items.map((i) => (
          <li key={i.id} className="shrink-0">
            <a
              href={`#${i.id}`}
              className="inline-flex min-h-[36px] items-center rounded-full border border-border bg-card px-3 text-xs font-medium text-foreground/85 transition-colors hover:border-[hsl(var(--gold-border))] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-ink))] motion-reduce:transition-none"
            >
              {t(i.labelKey)}
            </a>
          </li>
        ))}
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
    const privateOwner = owners.length > 0 && owners.every((o) => o.kind === 'PERSON');
    if (owners.length) {
      tiles.push({
        key: 'owner',
        label: t('vbi_glance_owner'),
        value: privateOwner ? t('vbi_reg_owner_person') : owners.map((o) => o.name).filter(Boolean).join(', '),
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
      note: finance.taxStatus.state === 'NOT_CHECKED' ? `${t('vbi_fin_tax')}: ${t('vbi_followup')}` : undefined,
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
