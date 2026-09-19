/*
 * WHO IS SELLING THIS, AND WHAT THE REGISTER SAYS ABOUT THEM.
 *
 * The run establishes a great deal about the developer — legal name, code,
 * registration date, directors and how they may sign, shareholding, registered
 * address, former names, and any pledge recorded against the COMPANY. For the
 * stored Villion report all of that sits in `result_json.companyProfile` and
 * none of it reached the reader, because the synthesis carries no `company`
 * block and the report renders from the synthesis. A registry-confirmed
 * company profile is the most trustworthy thing a verification produces, and
 * it was the part with no home on the page.
 *
 * THE DISTINCTION THIS CARD EXISTS TO HOLD
 *
 * A pledge registered against the company is NOT a mortgage on the flat. The
 * stored report has both, and they are different facts from different
 * documents:
 *
 *   COMPANY   PLEDGE_LEASE to Bank of Georgia, R23757008, 19/12/2023
 *   PROPERTY  a mortgage on the PARENT PARCEL 01.18.06.019.055, which the
 *             extract neither extends to nor excludes from this unit
 *
 * Collapsing those into "this apartment is mortgaged" would be the most
 * damaging sentence this product could print, and collapsing them the other
 * way would hide a real obligation. So they are two blocks, labelled, with the
 * property one carrying the extract's own words about what it does not prove.
 *
 * WHAT IT REFUSES TO SAY
 *
 * That this is the developer's first project. `relatedProjects: []` means the
 * run found none, which is a statement about the search and not about the
 * company. The card says what was searched and what was not found, and lets
 * the reader draw the inference.
 */
import {
  Building2, Users, ShieldCheck, FileText, Landmark, History, MapPin,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { VerifySection } from '@/components/verify/ui';

/** Directors arrive as strings on older runs and as objects on newer ones. */
type DirectorLike = string | { name?: unknown; representation?: unknown };

export interface CompanyProfileLike {
  name?: unknown;
  idCode?: unknown;
  legalForm?: unknown;
  status?: unknown;
  registrationDate?: unknown;
  registeredAddress?: unknown;
  governanceBody?: unknown;
  directors?: unknown;
  shareholders?: unknown;
  representatives?: unknown;
  historicalChanges?: unknown;
  relatedProjects?: unknown;
  encumbrances?: unknown;
  sourceBasis?: unknown;
  extractNumber?: unknown;
  liquidationRegistered?: unknown;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const directorName = (d: DirectorLike): string =>
  typeof d === 'string' ? d.trim() : str((d as { name?: unknown })?.name);
const directorRole = (d: DirectorLike): string =>
  typeof d === 'string' ? '' : str((d as { representation?: unknown })?.representation);

/**
 * Collapses entries naming the same person, preferring the one with a role.
 *
 * Matching is on the trimmed, case-folded name because the two shapes differ
 * only in structure, never in spelling.
 */
function dedupeByName(list: DirectorLike[]): DirectorLike[] {
  const seen = new Map<string, DirectorLike>();
  for (const entry of list) {
    const name = directorName(entry);
    if (!name) continue;
    const key = name.toLocaleLowerCase();
    const existing = seen.get(key);
    // A later entry replaces an earlier one only if it adds the role.
    if (!existing || (!directorRole(existing) && directorRole(entry))) {
      seen.set(key, entry);
    }
  }
  return [...seen.values()];
}

/** One labelled fact. Wraps rather than truncates: names here are long. */
function Fact({ icon: Icon, label, value }: {
  icon: typeof Building2; label: string; value: string;
}) {
  if (!value) return null;
  return (
    <div className="flex min-w-0 gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="min-w-0 break-words text-sm text-foreground">{value}</p>
      </div>
    </div>
  );
}

export function CompanyIntelligenceCard({
  company,
  /** result_json.rightsAndRestrictions — the PROPERTY-level picture. */
  rights,
}: {
  company?: CompanyProfileLike | null;
  rights?: { status?: unknown; items?: unknown; statement?: unknown } | null;
}) {
  const { t } = useLanguage();
  if (!company) return null;

  const name = str(company.name);
  const idCode = str(company.idCode);
  if (!name && !idCode) return null;

  /*
   * ONE ROW PER PERSON.
   *
   * The stored profile holds two directors. The customer-facing copy of it
   * reached this card carrying four entries — the same two people once as
   * objects with a representation role and once as bare strings — so the card
   * listed „კობა კვანტალიანი" twice and a reader could reasonably conclude the
   * company has four directors. Deduplicated by name, keeping whichever entry
   * actually states a role.
   */
  const directors = dedupeByName(arr(company.directors) as DirectorLike[]);
  const shareholders = arr(company.shareholders) as {
    name?: unknown; percentage?: unknown;
  }[];
  const changes = arr(company.historicalChanges).map(str).filter(Boolean);
  const projects = arr(company.relatedProjects).map(str).filter(Boolean);
  const encumbrances = arr(company.encumbrances) as {
    kind?: unknown; creditor?: unknown; reference?: unknown; registeredAt?: unknown;
  }[];
  const rightsItems = arr(rights?.items).map(str).filter(Boolean);
  const registryConfirmed = str(company.sourceBasis) === 'REGISTRY_CONFIRMED';

  return (
    <VerifySection
      eyebrow={t('verify_co_eyebrow')}
      title={name || idCode}
      subtitle={registryConfirmed ? t('verify_co_registry_confirmed') : t('verify_co_web_only')}
      accent
    >
      <div className="space-y-5">
        {/* ---- the identity the register holds ---- */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Fact icon={FileText} label={t('verify_co_id_code')} value={idCode} />
          <Fact icon={Building2} label={t('verify_co_legal_form')} value={str(company.legalForm)} />
          <Fact icon={History} label={t('verify_co_registered_on')} value={str(company.registrationDate)} />
          <Fact icon={MapPin} label={t('verify_co_address')} value={str(company.registeredAddress)} />
          <Fact icon={ShieldCheck} label={t('verify_co_governance')} value={str(company.governanceBody)} />
          <Fact icon={FileText} label={t('verify_co_extract')} value={str(company.extractNumber)} />
        </div>

        {/* ---- who may sign ---- */}
        {directors.length ? (
          <div className="min-w-0 space-y-2">
            <p className="text-2xs uppercase tracking-wide text-muted-foreground">
              {t('verify_co_directors')}
            </p>
            <ul className="space-y-1.5">
              {directors.map((d, i) => {
                const n = directorName(d);
                if (!n) return null;
                const role = directorRole(d);
                return (
                  <li key={i} className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="min-w-0 break-words text-sm text-foreground">{n}</span>
                    {role ? (
                      <span className="text-2xs text-muted-foreground break-words">{role}</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {/* ---- who owns it ---- */}
        {shareholders.length ? (
          <div className="min-w-0 space-y-2">
            <p className="text-2xs uppercase tracking-wide text-muted-foreground">
              {t('verify_co_shareholders')}
            </p>
            <ul className="space-y-1.5">
              {shareholders.map((s, i) => {
                const n = str(s?.name);
                if (!n) return null;
                const pct = Number(s?.percentage);
                return (
                  <li key={i} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <span className="min-w-0 break-words text-sm text-foreground">{n}</span>
                    {Number.isFinite(pct) ? (
                      <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{pct}%</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {/* ---- what it used to be called ---- */}
        {changes.length ? (
          <div className="min-w-0 space-y-1.5">
            <p className="text-2xs uppercase tracking-wide text-muted-foreground">
              {t('verify_co_history')}
            </p>
            {changes.map((c, i) => (
              <p key={i} className="min-w-0 break-words text-sm leading-relaxed text-ink-soft">{c}</p>
            ))}
          </div>
        ) : null}

        {/* ---- other projects, when any were established ----
            „ჩვენს მოძიებულ წყაროებში სხვა პროექტი ვერ დადასტურდა" described
            our search, not the developer, and a reader took it as evidence of
            inexperience. An empty result is now simply absent. */}
        {projects.length ? (
          <div className="min-w-0 space-y-1.5">
            <p className="text-2xs uppercase tracking-wide text-muted-foreground">
              {t('verify_co_projects')}
            </p>
            <ul className="space-y-1">
              {projects.map((p, i) => (
                <li key={i} className="min-w-0 break-words text-sm text-foreground">{p}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* ---- COMPANY-LEVEL obligations ---- */}
        {encumbrances.length ? (
          <div className="min-w-0 space-y-2 rounded-xl border border-border bg-background/40 p-3">
            <p className="text-2xs uppercase tracking-wide text-muted-foreground">
              {t('verify_co_company_obligations')}
            </p>
            <ul className="space-y-1.5">
              {encumbrances.map((e, i) => (
                <li key={i} className="min-w-0 break-words text-sm text-foreground">
                  {[str(e?.creditor), str(e?.reference), str(e?.registeredAt)]
                    .filter(Boolean)
                    .join(' · ')}
                </li>
              ))}
            </ul>
            {/* The sentence that stops a company pledge being read as a
                mortgage on the flat. */}
            <p className="min-w-0 break-words text-2xs leading-relaxed text-muted-foreground">
              {t('verify_co_company_scope_note')}
            </p>
          </div>
        ) : null}

        {/* ---- PROPERTY-LEVEL, kept visibly apart ---- */}
        {rightsItems.length ? (
          <div className="min-w-0 space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="flex items-center gap-1.5 text-2xs uppercase tracking-wide text-muted-foreground">
              <Landmark className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t('verify_co_property_obligations')}
            </p>
            <ul className="space-y-1.5">
              {rightsItems.map((r, i) => (
                <li key={i} className="min-w-0 break-words text-sm leading-relaxed text-foreground">{r}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* ---- the representation rule, stated once ---- */}
        {directors.length > 1 && directors.some((d) => /ერთობლივ|joint/i.test(directorRole(d))) ? (
          <p className="flex min-w-0 gap-2 text-2xs leading-relaxed text-muted-foreground">
            <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words">{t('verify_co_joint_note')}</span>
          </p>
        ) : null}
      </div>
    </VerifySection>
  );
}
