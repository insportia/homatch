// HOMATCH Verify — the official document explorer.
//
// What a buyer can actually open, grouped by what each file proves
// (src/verify/officialDocumentLibrary.ts): permits, decisions and register
// extracts first, then the approved project drawings, expert conclusions,
// site photos and everything else, the most useful file of each kind first,
// each group with one plain line on what it proves.
//
// OPENING A FILE. TAS's DownloadServlet answers many customer browsers with
// "Access Denied", so a raw DownloadServlet link is never a button here.
// Viewable files (pdf / jpg / png) open through HOMATCH's secure viewer
// (SecureFileButton: owner-checked, fetched once by the official worker,
// cached privately, signed for minutes). Technical formats (dwg, pla, rar …)
// are listed in the full library only, as not viewable in a browser; files
// the research could not retrieve never reach the main view; personal papers
// (power of attorney, identity documents) are never served.
//
// The full library (every case, every file) sits collapsed and is only
// MOUNTED when opened: hundreds of rows are not built for a reader who never
// asks for them. Images HOMATCH already extracted from a document (signed
// official visuals) open in the report's own viewer. Internal ids are never
// primary text.

import React from 'react';
import { FileText, FileImage, DraftingCompass, FileArchive, File, ChevronDown, Images, ShieldCheck } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  documentExplorer,
  visualSources,
  readStateOf,
  DOC_READ_KEY,
  DOC_STATUS_KEY,
  type DocCaseView,
  type DocCaseStatus,
  type DocReadState,
} from '@/verify/reportPresentation';
import { buildDocumentLibrary, type DocGroupKey, type LibraryItem } from '@/verify/officialDocumentLibrary';
import { catalogVisuals, type CatalogVisual } from '@/verify/visualCatalog';
import { OfficialImagesViewer } from './VisualExplorer';
import { OfficialLink, SecureFileButton, useVerifyJobId } from './OfficialLink';

type Clean = (s: string) => string;

const dmy = (iso?: string | null): string | null => {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
};
const isolate = (s: string) => `⁦${s}⁩`;

/** Group title and its one-line "what it proves" (scripts/verify-final-docs-i18n-data.mjs). */
export const DOC_GROUP_KEYS: Record<DocGroupKey, { title: string; proves: string }> = {
  PERMITS: { title: 'verify_fdocs_group_permits', proves: 'verify_fdocs_proves_permits' },
  DRAWINGS: { title: 'verify_fdocs_group_drawings', proves: 'verify_fdocs_proves_drawings' },
  EXPERT: { title: 'verify_fdocs_group_expert', proves: 'verify_fdocs_proves_expert' },
  PHOTOS: { title: 'verify_fdocs_group_photos', proves: 'verify_fdocs_proves_photos' },
  OTHER: { title: 'verify_fdocs_group_other', proves: 'verify_fdocs_proves_other' },
};

const iconOf = (i: LibraryItem): React.ComponentType<{ className?: string }> => {
  const f = i.format ?? '';
  if (/^(dwg|dxf|dwf|pla|pln|rvt|ifc|skp)$/.test(f)) return DraftingCompass;
  if (/^(rar|zip|7z|tar|gz)$/.test(f)) return FileArchive;
  if (/^(jpe?g|png|gif|bmp|tiff?|webp|heic)$/.test(f)) return FileImage;
  if (f === 'pdf') return i.group === 'DRAWINGS' ? DraftingCompass : FileText;
  return File;
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
  /** The report's job; falls back to VerifyJobProvider. Without one, files are listed but not openable. */
  jobId?: string | null;
}> = ({ docs, pendingRefs, visuals, identityUnresolved, clean, jobId: jobIdProp }) => {
  const { t } = useLanguage();
  const ctxJob = useVerifyJobId();
  const jobId = jobIdProp ?? ctxJob;
  const view = React.useMemo(() => documentExplorer(docs, pendingRefs ?? []), [docs, pendingRefs]);
  const library = React.useMemo(() => buildDocumentLibrary(docs), [docs]);
  const [libraryOpen, setLibraryOpen] = React.useState(false);
  const [viewer, setViewer] = React.useState<{ items: CatalogVisual[]; start: number } | null>(null);
  if (!view.recent.length) return null;
  const open = (items: CatalogVisual[]) => setViewer({ items, start: 0 });
  const cases = [...view.recent, ...view.earlier];

  return (
    <div className="space-y-5">
      {library.groups.length ? (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2" aria-label={t('verify_fdocs_main_title')}>
          {library.groups.map((g) => (
            <li key={g.key} className="min-w-0 rounded-2xl border border-[hsl(var(--gold-border))] bg-card p-4 shadow-[0_14px_36px_-24px_hsl(222_47%_11%/0.45)] sm:p-5" data-doc-group={g.key}>
              <h3 className="text-[15px] font-semibold leading-6 break-words">{t(DOC_GROUP_KEYS[g.key].title)}</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground break-words">{t(DOC_GROUP_KEYS[g.key].proves)}</p>
              <ul className="mt-3 divide-y divide-border border-t border-border">
                {g.top.map((i) => (
                  <FileRow key={`${i.attachedFileId}-${i.fileName}`} item={i} jobId={jobId} />
                ))}
              </ul>
              {g.more > 0 ? <p className="mt-2 text-2xs leading-5 text-muted-foreground">{t('verify_fdocs_more', { count: String(g.more) })}</p> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm leading-6 text-muted-foreground break-words">{t('verify_fdocs_none_viewable')}</p>
      )}

      <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground break-words">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0">{t('verify_fdocs_viewer_note')}</span>
      </p>

      <div className="rounded-2xl border border-border bg-card">
        <button
          type="button"
          aria-expanded={libraryOpen}
          aria-controls="vrx-docs-library"
          onClick={() => setLibraryOpen((o) => !o)}
          className="flex min-h-[48px] w-full items-center justify-between gap-3 rounded-2xl px-4 py-2 text-start text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--gold-ink))]"
        >
          <span className="min-w-0 break-words">{t('verify_fdocs_library', { count: String(library.counts.total), cases: String(cases.length) })}</span>
          <ChevronDown className={`h-4 w-4 shrink-0 motion-safe:transition-transform motion-safe:duration-300 ${libraryOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        {libraryOpen ? (
          <div id="vrx-docs-library">
            <FullLibrary cases={cases} items={library.all} visuals={visuals} identityUnresolved={identityUnresolved} jobId={jobId} onImages={open} />
          </div>
        ) : null}
      </div>

      {viewer ? <OfficialImagesViewer items={viewer.items} start={viewer.start} onClose={() => setViewer(null)} clean={clean} /> : null}
    </div>
  );
};

/** One file: name, case and date, what was read, and the secure "open" action when it is viewable. */
function FileRow({ item: i, jobId, inLibrary }: { item: LibraryItem; jobId: string | null; inLibrary?: boolean }) {
  const { t } = useLanguage();
  const Icon = iconOf(i);
  const date = dmy(i.caseDate);
  const read = readStateOf(i.outcome);
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground/70" aria-hidden="true">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-5 break-words [overflow-wrap:anywhere]" dir="auto">{i.fileName}</p>
        <p className="mt-0.5 flex flex-wrap gap-x-2 text-2xs leading-5 text-muted-foreground">
          {i.format ? <span className="whitespace-nowrap font-medium uppercase">{i.format}</span> : null}
          {i.pages ? <span className="whitespace-nowrap">{t('verify_v3_docs_pages', { count: String(i.pages) })}</span> : null}
          {!inLibrary && i.caseRef ? <span className="whitespace-nowrap">{t('verify_v3_case_ref', { ref: isolate(i.caseRef) })}</span> : null}
          {!inLibrary && date ? <span className="whitespace-nowrap">{isolate(date)}</span> : null}
          {inLibrary && !i.failed && i.access !== 'TECHNICAL' ? <span className={`font-medium ${READ_TONE[read]}`}>{t(DOC_READ_KEY[read])}</span> : null}
        </p>
        {i.access === 'VIEWABLE' && i.attachedFileId && jobId ? (
          <SecureFileButton jobId={jobId} attachedFileId={i.attachedFileId} />
        ) : i.access === 'TECHNICAL' ? (
          <p className="mt-1 text-2xs leading-5 text-muted-foreground">{t('verify_fdocs_technical')}</p>
        ) : i.access === 'PRIVATE' ? (
          <p className="mt-1 text-2xs leading-5 text-muted-foreground">{t('verify_fdocs_private')}</p>
        ) : null}
        {i.failed ? <p className="mt-1 text-2xs leading-5 text-muted-foreground">{t('verify_fdocs_not_retrieved')}</p> : null}
      </div>
    </li>
  );
}

/** Every case and every file: mounted only when the reader opens it. */
function FullLibrary({ cases, items, visuals, identityUnresolved, jobId, onImages }: {
  cases: DocCaseView[];
  items: LibraryItem[];
  visuals?: unknown[] | null;
  identityUnresolved?: boolean;
  jobId: string | null;
  onImages: (items: CatalogVisual[]) => void;
}) {
  const catalog = React.useMemo(() => catalogVisuals(visuals ?? [], [], [], { identityUnresolved }), [visuals, identityUnresolved]);
  const sources = React.useMemo(() => visualSources(visuals), [visuals]);
  return (
    <ul className="space-y-3 px-3 pb-3 sm:px-4 sm:pb-4">
      {cases.map((c, n) => (
        <CaseCard
          key={c.caseRef ?? c.documentId ?? n}
          c={c}
          files={items.filter((i) => i.caseRef === c.caseRef)}
          images={c.documentId ? catalog.filter((v) => sources.get(v.id)?.documentId === c.documentId) : []}
          jobId={jobId}
          onImages={onImages}
        />
      ))}
    </ul>
  );
}

function CaseCard({ c, files, images, jobId, onImages }: { c: DocCaseView; files: LibraryItem[]; images: CatalogVisual[]; jobId: string | null; onImages: (items: CatalogVisual[]) => void }) {
  const { t } = useLanguage();
  const date = dmy(c.date);
  return (
    <li className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5">
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
      {files.length ? (
        <ul className="mt-3 divide-y divide-border border-t border-border" aria-label={t('verify_v3_docs_files')}>
          {files.map((f, i) => <FileRow key={`${f.attachedFileId}-${i}`} item={f} jobId={jobId} inLibrary />)}
        </ul>
      ) : null}
      {images.length || c.href ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-4">
          {images.length ? <ImagesButton count={images.length} onClick={() => onImages(images)} /> : null}
          {/* The municipality's public case page: secondary, never a file download. */}
          {c.href ? <OfficialLink href={c.href} label={t('verify_fdocs_case_page')} /> : null}
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
