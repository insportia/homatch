// HOMATCH Verify — the official-history blocks of the report.
//
//   CurrentStatusBlock     the latest confirmed official position, with dates
//   PropertyStoryBlock     the documented history, oldest first, with the
//                          official TAS visuals placed beside the chapter they
//                          explain (never an unrelated gallery)
//   ResearchTransparency   what was reviewed, in counts — never links
//
// Every visual here is an official TAS attachment delivered as a short-lived
// signed URL. Marketplace photos never reach these components. A visual that
// fails to load is removed; the text stands on its own.

import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';

export interface CurrentStatusView {
  statement: string;
  items: Array<{ label: string; value: string; date?: string; cites?: string[] }>;
}
export interface StoryChapterView {
  key: string;
  title: string;
  period?: string;
  body: string;
  visualIds?: string[];
}
export interface VisualCaptionView {
  visualId: string;
  caption: string;
  explanation: string;
}
export interface OfficialVisualView {
  id: string;
  role: 'LATEST_RENDER' | 'EARLIEST_RENDER' | 'SUPPORTING' | string;
  kind: string;
  date?: string | null;
  width?: number | null;
  height?: number | null;
  url: string;
}
export interface ResearchCoverageView {
  researchedAt?: string | null;
  latestOfficialDocumentDate?: string | null;
  earliestOfficialDocumentDate?: string | null;
  officialCasesReviewed?: number;
  officialStepsReviewed?: number;
  officialAttachmentsRead?: number;
  officialFactsConsolidated?: number;
  marketListingsAnalyzed?: number;
}

const day = (iso?: string | null): string | null => {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
};

/* Only signed storage URLs are rendered — a guard, not a style choice. */
const safeVisualUrl = (u: unknown): string | null =>
  typeof u === 'string' && /^https:\/\/[^/]+\/storage\/v1\/object\/sign\//.test(u) ? u : null;

export const CurrentStatusBlock: React.FC<{ status?: CurrentStatusView | null; clean: (s: string) => string }> = ({ status, clean }) => {
  const { t } = useLanguage();
  if (!status || (!clean(status.statement) && !status.items?.length)) return null;
  return (
    <section aria-labelledby="verify-current-status" className="rounded-2xl border border-border bg-card/50 p-5 sm:p-6 space-y-4">
      <div className="space-y-1">
        <p className="text-2xs uppercase tracking-wider text-[hsl(var(--gold-ink))]">{t('verify_ox_current_kicker')}</p>
        <h2 id="verify-current-status" className="text-base font-semibold tracking-tight break-words">
          {t('verify_ox_current_title')}
        </h2>
      </div>
      {clean(status.statement) ? <p className="text-[15px] leading-7 text-foreground/90 break-words">{clean(status.statement)}</p> : null}
      {status.items?.length ? (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {status.items.map((i, n) => (
            <div key={`${i.label}-${n}`} className="min-w-0 rounded-xl border border-border bg-card px-4 py-3">
              <dt className="text-2xs uppercase tracking-wider text-muted-foreground break-words">{clean(i.label)}</dt>
              <dd className="mt-1 text-sm font-semibold break-words">{clean(i.value)}</dd>
              {day(i.date) ? (
                <dd className="mt-0.5 text-2xs text-muted-foreground tabular-nums">
                  {t('verify_ox_as_of')} {day(i.date)}
                </dd>
              ) : null}
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
};

const VisualFigure: React.FC<{
  v: OfficialVisualView;
  caption?: VisualCaptionView;
  badge?: string;
  clean: (s: string) => string;
  onBroken: (id: string) => void;
}> = ({ v, caption, badge, clean, onBroken }) => {
  const { t } = useLanguage();
  const url = safeVisualUrl(v.url);
  if (!url) return null;
  const ratio = v.width && v.height ? `${v.width} / ${v.height}` : '16 / 10';
  const label = caption ? clean(caption.caption) : t('verify_ox_visual_default');
  return (
    <figure className="min-w-0 space-y-2">
      <div className="relative overflow-hidden rounded-xl border border-border bg-[hsl(222_47%_11%)]" style={{ aspectRatio: ratio }}>
        <img
          src={url}
          alt={label}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="h-full w-full object-contain"
          onError={() => onBroken(v.id)}
        />
        {badge ? (
          <span className="absolute start-3 top-3 rounded-full bg-[hsl(222_47%_11%)]/85 px-2.5 py-1 text-2xs font-medium text-[hsl(38_92%_64%)] ring-1 ring-[hsl(38_92%_54%)]/40">
            {badge}
          </span>
        ) : null}
      </div>
      <figcaption className="space-y-0.5">
        <p className="text-sm font-medium break-words">
          {label}
          {day(v.date) ? <span className="ms-2 text-2xs font-normal text-muted-foreground tabular-nums">{day(v.date)}</span> : null}
        </p>
        {caption?.explanation ? <p className="text-xs leading-5 text-muted-foreground break-words">{clean(caption.explanation)}</p> : null}
      </figcaption>
    </figure>
  );
};

export const PropertyStoryBlock: React.FC<{
  chapters?: StoryChapterView[] | null;
  visuals?: OfficialVisualView[] | null;
  captions?: VisualCaptionView[] | null;
  clean: (s: string) => string;
}> = ({ chapters, visuals, captions, clean }) => {
  const { t } = useLanguage();
  const [broken, setBroken] = React.useState<Set<string>>(() => new Set());
  const onBroken = React.useCallback((id: string) => setBroken((b) => new Set(b).add(id)), []);
  const story = (chapters ?? []).filter((c) => clean(c.body));
  const usable = (visuals ?? []).filter((v) => safeVisualUrl(v.url) && !broken.has(v.id)).slice(0, 6);
  if (!story.length && !usable.length) return null;

  const captionFor = (id: string) => (captions ?? []).find((c) => c.visualId === id);
  const latest = usable.find((v) => v.role === 'LATEST_RENDER');
  const earliest = usable.find((v) => v.role === 'EARLIEST_RENDER');
  const comparison = latest && earliest ? { latest, earliest } : null;

  // Each visual appears ONCE: where the story placed it, else by its own
  // chapter hint, else after the last chapter. The two renders of a
  // comparison are shown together, in the chapter of the earlier one.
  const placed = new Map<string, string[]>();
  const used = new Set<string>();
  const place = (chapterKey: string, id: string) => {
    if (used.has(id)) return;
    used.add(id);
    placed.set(chapterKey, [...(placed.get(chapterKey) ?? []), id]);
  };
  if (comparison && story.length) {
    const host = story.find((c) => c.visualIds?.includes(comparison.earliest.id))?.key ?? story[0].key;
    used.add(comparison.latest.id);
    used.add(comparison.earliest.id);
    placed.set(host, ['__comparison__']);
  }
  for (const c of story) for (const id of c.visualIds ?? []) if (usable.some((v) => v.id === id)) place(c.key, id);
  const lastKey = story.length ? story[story.length - 1].key : '__none__';
  for (const v of usable) if (!used.has(v.id)) place(lastKey, v.id);

  const renderVisuals = (key: string) =>
    (placed.get(key) ?? []).map((id) =>
      id === '__comparison__' && comparison ? (
        <div key="cmp" className="space-y-2">
          <p className="text-2xs uppercase tracking-wider text-muted-foreground">{t('verify_ox_evolution_title')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <VisualFigure v={comparison.earliest} caption={captionFor(comparison.earliest.id)} badge={t('verify_ox_original')} clean={clean} onBroken={onBroken} />
            <VisualFigure v={comparison.latest} caption={captionFor(comparison.latest.id)} badge={t('verify_ox_latest')} clean={clean} onBroken={onBroken} />
          </div>
        </div>
      ) : (
        (() => {
          const v = usable.find((x) => x.id === id);
          return v ? <VisualFigure key={id} v={v} caption={captionFor(id)} clean={clean} onBroken={onBroken} /> : null;
        })()
      ),
    );

  return (
    <section aria-labelledby="verify-story" className="space-y-5">
      <div className="space-y-1">
        <p className="text-2xs uppercase tracking-wider text-[hsl(var(--gold-ink))]">{t('verify_ox_story_kicker')}</p>
        <h2 id="verify-story" className="text-base font-semibold tracking-tight break-words">{t('verify_ox_story_title')}</h2>
      </div>
      {story.length ? (
        <ol className="relative space-y-6 border-s border-[hsl(38_92%_54%)]/30 ps-5">
          {story.map((c) => (
            <li key={c.key} className="relative space-y-3">
              <span aria-hidden="true" className="absolute -start-[25px] top-1.5 h-2.5 w-2.5 rounded-full bg-[hsl(38_92%_54%)] ring-4 ring-background" />
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="text-sm font-semibold break-words">{clean(c.title)}</h3>
                {c.period ? <span className="text-2xs text-muted-foreground tabular-nums">{c.period}</span> : null}
              </div>
              {clean(c.body).split(/\n{2,}/).map((p, i) => (
                <p key={i} className="text-[15px] leading-7 text-foreground/90 break-words">{p}</p>
              ))}
              {renderVisuals(c.key)}
            </li>
          ))}
        </ol>
      ) : (
        <div className="space-y-4">{renderVisuals('__none__')}</div>
      )}
      <p className="text-2xs leading-relaxed text-muted-foreground break-words">{t('verify_ox_visual_note')}</p>
    </section>
  );
};

export const ResearchTransparency: React.FC<{ coverage?: ResearchCoverageView | null }> = ({ coverage }) => {
  const { t } = useLanguage();
  if (!coverage) return null;
  const chips: Array<{ label: string; value: string }> = [];
  if (day(coverage.researchedAt)) chips.push({ label: t('verify_ox_rx_date'), value: day(coverage.researchedAt)! });
  if (day(coverage.latestOfficialDocumentDate)) chips.push({ label: t('verify_ox_rx_latest_doc'), value: day(coverage.latestOfficialDocumentDate)! });
  if (coverage.officialCasesReviewed) chips.push({ label: t('verify_ox_rx_cases'), value: String(coverage.officialCasesReviewed) });
  if (coverage.officialAttachmentsRead) chips.push({ label: t('verify_ox_rx_documents'), value: String(coverage.officialAttachmentsRead) });
  if (coverage.marketListingsAnalyzed) chips.push({ label: t('verify_ox_rx_listings'), value: String(coverage.marketListingsAnalyzed) });
  const official = !!coverage.officialCasesReviewed;
  const market = !!coverage.marketListingsAnalyzed;
  if (!official && !market && !chips.length) return null;
  // Only describes checks that actually completed.
  const sentence = official && market ? t('verify_ox_rx_both') : official ? t('verify_ox_rx_official') : market ? t('verify_ox_rx_market') : '';
  return (
    <section aria-labelledby="verify-transparency" className="rounded-2xl border border-border bg-card/40 p-5 space-y-3">
      <h2 id="verify-transparency" className="text-sm font-semibold tracking-tight">{t('verify_ox_rx_title')}</h2>
      {sentence ? <p className="text-sm leading-6 text-muted-foreground break-words">{sentence}</p> : null}
      {chips.length ? (
        <dl className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <div key={c.label} className="min-w-0 rounded-full border border-border bg-card px-3 py-1.5 text-xs">
              <dt className="inline text-muted-foreground">{c.label}: </dt>
              <dd className="inline font-medium tabular-nums">{c.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
};
