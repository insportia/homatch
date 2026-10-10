// HOMATCH Verify — the official document explorer.
//
// Every municipal (TAS) application HOMATCH read for this property, as the
// reader would want to browse it: the two newest applications first, each
// with its human title, case number, date and a status chip that never says
// "approved" unless the record does (caseStatusOf in reportPresentation.ts),
// then its files — type, format, pages, and what HOMATCH could do with each.
// Older applications sit collapsed under "Earlier applications (N)".
//
// Viewing: a file opens at its official source in a new tab — HOMATCH does
// not proxy private copies. Images HOMATCH already extracted from a document
// (signed official visuals) open in the report's own viewer. Internal ids are
// never primary text.

import React from 'react';
import { FileText, FileImage, DraftingCompass, FileArchive, File, ChevronDown, Images } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  documentExplorer,
  visualSources,
  DOC_READ_KEY,
  DOC_STATUS_KEY,
  type DocCaseView,
  type DocFileKind,
  type DocReadState,
  type DocCaseStatus,
} from '@/verify/reportPresentation';
import { catalogVisuals, type CatalogVisual } from '@/verify/visualCatalog';
import { OfficialImagesViewer } from './VisualExplorer';
import { OfficialLink } from './OfficialLink';

type Clean = (s: string) => string;

const dmy = (iso?: string | null): string | null => {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
};
const isolate = (s: string) => `⁦${s}⁩`;

const FILE_ICON: Record<DocFileKind, React.ComponentType<{ className?: string }>> = {
  PDF: FileText,
  IMAGE: FileImage,
  DRAWING: DraftingCompass,
  ARCHIVE: FileArchive,
  OTHER: File,
};

const STATUS_TONE: Record<DocCaseStatus, string> = {
  UNDER_REVIEW: 'bg-amber-50 text-amber-900 ring-amber-600/30',
  APPROVED: 'bg-emerald-50 text-emerald-900 ring-emerald-700/25',
  REFUSED: 'bg-slate-100 text-slate-800 ring-slate-500/30',
  HISTORICAL: 'bg-muted text-muted-foreground ring-border',
};

const READ_TONE: Record<DocReadState, string> = {
  READ: 'text-emerald-800',
  VISUAL: 'text-sky-800',
  UNSUPPORTED: 'text-muted-foreground',
  DEFERRED: 'text-amber-800',
  NOT_READ: 'text-muted-foreground',
};

export function hasOfficialDocuments(docs: unknown): boolean {
  const { recent } = documentExplorer(docs);
  return recent.length > 0;
}

export const OfficialDocuments: React.FC<{
  docs?: unknown;
  pendingRefs?: string[];
  visuals?: unknown[] | null;
  identityUnresolved?: boolean;
  clean: Clean;
}> = ({ docs, pendingRefs, visuals, identityUnresolved, clean }) => {
  const { t } = useLanguage();
  const view = React.useMemo(() => documentExplorer(docs, pendingRefs ?? []), [docs, pendingRefs]);
  const catalog = React.useMemo(() => catalogVisuals(visuals ?? [], [], [], { identityUnresolved }), [visuals, identityUnresolved]);
  const sources = React.useMemo(() => visualSources(visuals), [visuals]);
  const [earlierOpen, setEarlierOpen] = React.useState(false);
  const [viewer, setViewer] = React.useState<{ items: CatalogVisual[]; start: number } | null>(null);
  if (!view.recent.length) return null;
  const open = (items: CatalogVisual[]) => setViewer({ items, start: 0 });

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-[0.08em] text-[hsl(var(--gold-ink))]">
          <span className="h-px w-6 shrink-0 bg-[hsl(var(--gold-border))]" aria-hidden="true" />
          {t(view.recent.length > 1 ? 'verify_v3_docs_recent_two' : 'verify_v3_docs_recent_one')}
        </p>
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {view.recent.map((c, i) => (
            <CaseCard key={c.caseRef ?? c.documentId ?? i} c={c} catalog={catalog} sources={sources} onImages={open} highlight />
          ))}
        </ul>
      </div>

      {view.earlier.length ? (
        <div className="rounded-2xl border border-border bg-card">
          <button
            type="button"
            aria-expanded={earlierOpen}
            aria-controls="vrx-docs-earlier"
            onClick={() => setEarlierOpen((o) => !o)}
            className="flex min-h-[48px] w-full items-center justify-between gap-3 rounded-2xl px-4 py-2 text-start text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-ink))]"
          >
            <span className="min-w-0 break-words">{t('verify_v3_docs_earlier', { count: String(view.earlier.length) })}</span>
            <ChevronDown className={`h-4 w-4 shrink-0 motion-safe:transition-transform motion-safe:duration-300 ${earlierOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
          <div
            id="vrx-docs-earlier"
            className={`grid motion-safe:transition-[grid-template-rows,opacity] motion-safe:duration-300 motion-safe:ease-out ${earlierOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
            aria-hidden={!earlierOpen}
            {...(!earlierOpen ? { inert: '' as unknown as boolean } : {})}
          >
            <div className="min-h-0 overflow-hidden">
              <ul className="space-y-3 px-3 pb-3 sm:px-4 sm:pb-4">
                {view.earlier.map((c, i) => (
                  <CaseCard key={c.caseRef ?? c.documentId ?? i} c={c} catalog={catalog} sources={sources} onImages={open} />
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      <p className="text-xs leading-5 text-muted-foreground break-words">{t('verify_v3_docs_note')}</p>

      {viewer ? <OfficialImagesViewer items={viewer.items} start={viewer.start} onClose={() => setViewer(null)} clean={clean} /> : null}
    </div>
  );
};

function CaseCard({ c, catalog, sources, onImages, highlight }: { c: DocCaseView; catalog: CatalogVisual[]; sources: Map<string, { documentId: string; fileName: string | null }>; onImages: (items: CatalogVisual[]) => void; highlight?: boolean }) {
  const { t } = useLanguage();
  const date = dmy(c.date);
  const caseImages = c.documentId ? catalog.filter((v) => sources.get(v.id)?.documentId === c.documentId) : [];
  const fileOf = (v: CatalogVisual) => sources.get(v.id)?.fileName ?? null;
  const fileNames = new Set(c.files.map((f) => f.fileName).filter(Boolean));
  // Images that match no listed file still belong to the case.
  const unmatched = caseImages.filter((v) => !fileOf(v) || !fileNames.has(fileOf(v)));
  return (
    <li className={`min-w-0 rounded-2xl border bg-card p-4 sm:p-5 ${highlight ? 'border-[hsl(var(--gold-border))] shadow-[0_14px_36px_-24px_hsl(222_47%_11%/0.45)]' : 'border-border'}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <h3 className="min-w-0 flex-1 basis-[12rem] text-[15px] font-semibold leading-6 break-words" dir="auto">
          {c.title ?? t('verify_v3_docs_untitled')}
        </h3>
        <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-1 text-2xs font-semibold ring-1 ${STATUS_TONE[c.status]}`} data-status={c.status}>
          {t(DOC_STATUS_KEY[c.status])}
        </span>
      </div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground break-words">
        {[c.caseRef ? t('verify_v3_case_ref', { ref: isolate(c.caseRef) }) : null, date ? isolate(date) : null].filter(Boolean).join(' · ')}
      </p>

      {c.files.length ? (
        <ul className="mt-3 divide-y divide-border border-t border-border" aria-label={t('verify_v3_docs_files')}>
          {c.files.map((f, i) => {
            const Icon = FILE_ICON[f.kind];
            const images = f.fileName ? caseImages.filter((v) => fileOf(v) === f.fileName) : [];
            const href = f.href ?? c.href;
            return (
              <li key={`${f.fileName}-${i}`} className="flex items-start gap-3 py-2.5">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground/70" aria-hidden="true">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-5 break-words [overflow-wrap:anywhere]" dir="auto">{f.fileName ?? t('verify_v3_docs_file')}</p>
                  <p className="mt-0.5 flex flex-wrap gap-x-2 text-2xs leading-5 text-muted-foreground">
                    {f.format ? <span className="whitespace-nowrap font-medium uppercase">{f.format}</span> : null}
                    {f.pages ? <span className="whitespace-nowrap">{t('verify_v3_docs_pages', { count: String(f.pages) })}</span> : null}
                    <span className={`font-medium ${READ_TONE[f.read]}`}>{t(DOC_READ_KEY[f.read])}</span>
                  </p>
                  <div className="flex flex-wrap items-center gap-x-4">
                    {images.length ? <ImagesButton count={images.length} onClick={() => onImages(images)} /> : null}
                    {href ? <OfficialLink href={href} label={t('verify_v3_docs_open_original')} /> : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {unmatched.length || (!c.files.length && c.href) ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-4">
          {unmatched.length ? <ImagesButton count={unmatched.length} onClick={() => onImages(unmatched)} /> : null}
          {!c.files.length && c.href ? <OfficialLink href={c.href} label={t('verify_v3_docs_open_case')} /> : null}
        </div>
      ) : null}
    </li>
  );
}

function ImagesButton({ count, onClick }: { count: number; onClick: () => void }) {
  const { t } = useLanguage();
  return (
    <button
      type="button"
      onClick={onClick}
      className="-mx-1 inline-flex min-h-[44px] items-center gap-1.5 rounded px-1 text-xs font-semibold text-foreground/85 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-ink))]"
    >
      <Images className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {t('verify_v3_docs_view_images', { count: String(count) })}
    </button>
  );
}
