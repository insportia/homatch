/*
 * HOMATCH Verify — ქონების ძირითადი მონაცემები (v7).
 *
 * The exact property area and the latest extract, near the top of the
 * report (owner, 2026-10-11). The model is src/verify/propertyFacts.ts: only
 * the fields that apply to the registry kind are shown, the unit's area is
 * never the parcel's or the building's, and the extract date is labelled as
 * the latest AVAILABLE extract, not the current legal state.
 */
import { useLanguage } from '@/contexts/LanguageContext';
import { VerifySection, Row, RowList } from './ui';
import { OfficialLink } from './OfficialLink';
import { buildPropertyFacts, type FactRow } from '@/verify/propertyFacts';

/** First-strong isolate: keeps codes, numbers and dates in reading order inside RTL text. */
const iso = (s: string): string => `⁦${s}⁩`;

function FactValue({ row }: { row: FactRow }) {
  const { t } = useLanguage();
  if (row.valueKey) {
    const vars = row.vars ? Object.fromEntries(Object.entries(row.vars).map(([k, v]) => [k, iso(v)])) : undefined;
    return <>{t(row.valueKey, vars)}</>;
  }
  const v = row.value ?? '';
  return <>{row.key === 'cadastral' || row.key === 'extractDate' ? iso(v) : v}</>;
}

export function PropertyFactsCard({ synthesis }: { synthesis: unknown }) {
  const { t } = useLanguage();
  const model = buildPropertyFacts(synthesis);
  if (!model || !model.rows.length) return null;
  return (
    <VerifySection id="vbi-facts" eyebrow={t('verify_v7_facts_eyebrow')} title={t('verify_v7_facts_title')} accent>
      <div className="space-y-2 text-sm leading-6 text-muted-foreground">
        <p>{t('verify_v7_facts_lede')}</p>
        <p>{t('verify_v7_facts_lede_note')}</p>
      </div>
      <RowList className="mt-4">
        {model.rows.map((row) => (
          <Row key={row.key} label={t(row.labelKey)}>
            <span className={row.key === 'area' || row.key === 'extractDate' ? 'font-semibold' : 'font-medium'}>
              <FactValue row={row} />
            </span>
            {row.key === 'kind' && model.ambiguityKey ? (
              <span className="block text-xs leading-5 text-muted-foreground">{t(model.ambiguityKey)}</span>
            ) : null}
          </Row>
        ))}
      </RowList>
      {model.secondary.length ? (
        <ul className="mt-3 space-y-1 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
          {model.secondary.map((row) => (
            <li key={row.key} className="break-words">
              {t(row.labelKey)}: <FactValue row={row} />
            </li>
          ))}
        </ul>
      ) : null}
      {model.link ? (
        <div className="mt-3">
          <OfficialLink href={model.link.href} label={t(model.link.labelKey)} />
        </div>
      ) : null}
    </VerifySection>
  );
}

export default PropertyFactsCard;
