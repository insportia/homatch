/*
 * COMPANY & OWNERSHIP.
 *
 * Who the developer actually is, who owns them, who can sign for them, and
 * what is registered against them — read from the entrepreneur registry
 * extract rather than inferred from a project's own marketing.
 *
 * This section exists because the previous report could not answer any of
 * those questions. Company intelligence arrived as a name and a sentence, and
 * a reader learned more about what Homatch had failed to find than about the
 * company selling them an apartment. The data path behind this is
 * deterministic end to end (see src/verify/intelligence/companyIntelligence.ts
 * and the 2026-09-19 incident); this file only decides what a buyer sees
 * first.
 *
 * IT IS NOT A REGISTRY DUMP.
 *
 * The extract contains rows that answer questions rather than state findings
 * — five "not registered" encumbrance lines, personal identification numbers,
 * internal governance wording. Those are filtered upstream. What remains is
 * grouped the way somebody actually reads it: who the company is, who owns
 * it, who binds it, and then anything registered against it.
 *
 * THE TWO DISTINCTIONS THIS COMPONENT MUST NOT BLUR
 *
 * 1. A charge registered in the ENTREPRENEUR registry is a charge over the
 *    COMPANY. It is not a statement about the specific apartment, whose
 *    encumbrances live in the property registry. The section says so in
 *    words, every time, because a pledge quoted without its scope is how a
 *    company's construction financing turns into alarm about a flat.
 *
 * 2. A pledge is EVIDENCE, not a verdict. Development companies routinely
 *    pledge assets to finance building. The section reports what is
 *    registered and with whom, and leaves the conclusion to the reader —
 *    while still giving it the prominence a material registry finding earns.
 *
 * And when the official lookup could not run at all, this says exactly that.
 * It never reports an empty result as though the registry had been consulted.
 */
import { useLanguage } from '@/contexts/LanguageContext';
import { VerifySection, Row, RowList, StatusPill } from './ui';
import {
  buildCompanyIntelligence, materialCompanyFindings,
  type CompanyIntelligence, type RepresentationRule,
} from '@/verify/intelligence/companyIntelligence';

const REPRESENTATION_KEY: Record<RepresentationRule, string> = {
  JOINT: 'co_rep_joint',
  SOLE: 'co_rep_sole',
  MIXED: 'co_rep_mixed',
  UNKNOWN: 'co_rep_unknown',
};

/** Percentages are shown as the registry stated them — never rounded up to a
 * tidier number, never recomputed from unit counts. */
function pct(value: number | null): string | null {
  if (value === null) return null;
  return `${Number.isInteger(value) ? value : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}%`;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-2xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

export function CompanyOwnershipCard({ report }: { report: unknown }) {
  const { t } = useLanguage();
  const company = buildCompanyIntelligence(report);
  if (!company) return null;

  /*
   * THE SOURCE DID NOT RUN.
   *
   * One calm sentence naming what was not checked, and nothing else. The
   * wrong version of this screen lists every empty field beneath a heading,
   * which reads as a series of findings about the company when it is really
   * one fact about this run.
   */
  if (company.status === 'SOURCE_UNAVAILABLE') {
    return (
      <VerifySection eyebrow={t('co_eyebrow')} title={t('co_title')}>
        {company.legalName ? (
          <RowList>
            <Row label={t('co_legal_name')}>{company.legalName}</Row>
          </RowList>
        ) : null}
        <p className="mt-3 min-w-0 break-words text-sm leading-relaxed text-muted-foreground">
          {t('co_source_unavailable')}
        </p>
      </VerifySection>
    );
  }

  const material = materialCompanyFindings(company);
  const registry = company.registryBacked;

  return (
    <VerifySection
      eyebrow={t('co_eyebrow')}
      title={t('co_title')}
      actions={
        <StatusPill tone={registry ? 'confirmed' : 'quiet'}>
          {t(registry ? 'co_registry_confirmed' : 'co_web_only')}
        </StatusPill>
      }
      accent={material.length > 0}
    >
      <div className="space-y-5">
        {/* ---- who the company is ---- */}
        <Group title={t('co_company')}>
          <RowList>
            {company.legalName ? <Row label={t('co_legal_name')}>{company.legalName}</Row> : null}
            {company.idCode ? (
              <Row label={t('co_id_code')}><span className="tabular-nums">{company.idCode}</span></Row>
            ) : null}
            {company.legalForm ? <Row label={t('co_legal_form')}>{company.legalForm}</Row> : null}
            {company.registrationDate ? (
              <Row label={t('co_registered')}><span className="tabular-nums">{company.registrationDate}</span></Row>
            ) : null}
            {company.registeredAddress ? (
              <Row label={t('co_address')}>{company.registeredAddress}</Row>
            ) : null}
          </RowList>
        </Group>

        {/* ---- who owns it ---- */}
        {company.ownership.length ? (
          <Group title={t('co_ownership')}>
            <RowList>
              {company.ownership.map((o, i) => (
                <Row key={`${o.name}-${i}`} label={o.name}>
                  <span className="tabular-nums">{pct(o.percentage) ?? '—'}</span>
                </Row>
              ))}
            </RowList>
            {company.ownershipTotal !== null ? (
              <p className="mt-2 text-2xs leading-relaxed text-muted-foreground">
                {t('co_total')}: <span className="tabular-nums">{pct(company.ownershipTotal)}</span>
                {company.ownershipConsistent === false ? ` · ${t('co_inconsistent')}` : ''}
              </p>
            ) : null}
          </Group>
        ) : null}

        {/* ---- who can sign for it ---- */}
        {company.directors.length ? (
          <Group title={t('co_management')}>
            <RowList>
              {company.directors.map((d, i) => (
                <Row key={`${d.name}-${i}`} label={t('co_director')}>{d.name}</Row>
              ))}
              {company.representationRule !== 'UNKNOWN' ? (
                <Row label={t('co_representation')}>{t(REPRESENTATION_KEY[company.representationRule])}</Row>
              ) : null}
            </RowList>
          </Group>
        ) : null}

        {/*
          * ---- what is registered against it ----
          *
          * Given real prominence, because it is the one thing here that
          * changes what a buyer should ask next — and given its SCOPE in the
          * same breath, because that is what keeps it honest.
          */}
        {material.length ? (
          <Group title={t('co_encumbrances')}>
            <div className="space-y-2">
              {material.map((e, i) => (
                <div
                  key={`${e.reference ?? e.kind}-${i}`}
                  className="min-w-0 rounded-xl border border-[hsl(var(--gold-border))] bg-[hsl(var(--gold-soft))] p-4"
                >
                  <RowList>
                    {e.reference ? (
                      <Row label={t('co_enc_reference')}><span className="tabular-nums">{e.reference}</span></Row>
                    ) : null}
                    {e.creditor ? <Row label={t('co_enc_creditor')}>{e.creditor}</Row> : null}
                    {e.registeredAt ? (
                      <Row label={t('co_enc_date')}><span className="tabular-nums">{e.registeredAt}</span></Row>
                    ) : null}
                  </RowList>
                </div>
              ))}
            </div>
            <p className="mt-2 min-w-0 break-words text-2xs leading-relaxed text-muted-foreground">
              {t('co_company_level_note')}
            </p>
          </Group>
        ) : null}

        {/* ---- the document this came from, and when it was issued ---- */}
        {registry && (company.extractNumber || company.extractPreparedAt) ? (
          <p className="min-w-0 break-words border-t border-border pt-3 text-2xs leading-relaxed text-muted-foreground">
            {t('co_extract_note')}
            {company.extractNumber ? ` ${company.extractNumber}` : ''}
            {company.extractPreparedAt ? ` · ${company.extractPreparedAt}` : ''}
          </p>
        ) : null}
      </div>
    </VerifySection>
  );
}
