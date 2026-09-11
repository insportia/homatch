// HOMATCH — the full document reader (§8, §17).
//
// The old panel rendered the entire contract analysis inline, permanently
// expanded, under the upload button. Three documents produced a page nobody
// could navigate, and there was nowhere to actually READ the document —
// the text we extracted from it was thrown away after the analysis ran.
//
// So reading moves here: a full-height drawer with four tabs, opened
// deliberately, closed deliberately, and never in the way of the list.
//
//   Overview        the summary and what deserves attention
//   Analysis        the structured findings, in cards rather than a blob
//   Document        the text itself, set for reading
//   Details         metadata and the document's own history
//
// A drawer rather than a route: a customer reading a clause is comparing it
// against the list they came from, and a full page navigation loses that
// context along with their scroll position and their filters.

import React, { useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Copy, Check, Download, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { SectionBoundary } from '@/components/common/SectionBoundary';
import {
  getExtractedText, listDocumentEvents, downloadUrlFor,
  type WorkspaceDocument, type DocumentEvent,
} from '@/services/documentWorkspace';
import {
  DOCUMENT_CATEGORY_KEY, DOCUMENT_STATUS_KEY, findingCounts,
  type NormalDocumentAnalysis,
} from '@/documents/documentModel';
import { reportError } from '@/lib/errorReporting';

const EVENT_KEY: Record<string, string> = {
  UPLOADED: 'doc_event_uploaded',
  QUEUED: 'doc_event_queued',
  EXTRACTION_STARTED: 'doc_event_extraction_started',
  EXTRACTION_COMPLETED: 'doc_event_extraction_completed',
  ANALYSIS_STARTED: 'doc_event_analysis_started',
  ANALYSIS_COMPLETED: 'doc_event_analysis_completed',
  ANALYSIS_FAILED: 'doc_event_analysis_failed',
  REANALYZED: 'doc_event_reanalyzed',
  RENAMED: 'doc_event_renamed',
  RECATEGORIZED: 'doc_event_recategorized',
  ARCHIVED: 'doc_event_archived',
  RESTORED: 'doc_event_restored',
  DELETED: 'doc_event_deleted',
};

/** Copy, with the confirmation the customer needs to know it worked. */
const CopyButton: React.FC<{ value: string; label: string }> = ({ value, label }) => {
  const { t } = useLanguage();
  const [done, setDone] = useState(false);
  if (!value) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-2"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch {
          // A blocked clipboard is a browser decision, not a failure of ours.
          toast.error(t('doc_copy_failed'));
        }
      }}
    >
      {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      <span className="break-words">{label}</span>
    </Button>
  );
};

const Quote: React.FC<{ quote: string; page: number | null }> = ({ quote, page }) => {
  if (!quote) return null;
  return (
    <blockquote className="mt-1.5 border-s-2 ps-3 text-sm text-muted-foreground break-words">
      {quote}
      {page ? ` (p. ${page})` : ''}
    </blockquote>
  );
};

/* ------------------------------------------------------------------ *
 * Structured findings (§15)                                           *
 * ------------------------------------------------------------------ */

const AnalysisTab: React.FC<{ analysis: NormalDocumentAnalysis | null }> = ({ analysis }) => {
  const { t } = useLanguage();
  if (!analysis) return <p className="text-sm text-muted-foreground break-words">{t('doc_reader_no_analysis')}</p>;

  // Attention first. A one-sided clause is the single most valuable thing
  // this feature surfaces, and burying it in document order hides it.
  const attention = analysis.clauses.filter((c) => c.attention !== 'NORMAL');
  const ordinary = analysis.clauses.filter((c) => c.attention === 'NORMAL');

  const Group: React.FC<{ titleKey: string; children: React.ReactNode; count: number }> = ({ titleKey, children, count }) =>
    count === 0 ? null : (
      <section className="space-y-2.5">
        <h3 className="text-sm font-semibold break-words">{t(titleKey)}</h3>
        <div className="space-y-3">{children}</div>
      </section>
    );

  return (
    <div className="space-y-6">
      <Group titleKey="doc_group_attention" count={attention.length}>
        {attention.map((c, i) => (
          <div key={i} className="rounded-lg border border-amber-300/70 dark:border-amber-800 p-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <p className="text-sm font-medium break-words">{c.label}</p>
              <Badge variant="outline" className="font-normal">{t(`doc_attention_${c.attention.toLowerCase()}`)}</Badge>
            </div>
            {c.plain ? <p className="mt-1 text-sm break-words">{c.plain}</p> : null}
            <Quote quote={c.quote} page={c.page} />
          </div>
        ))}
      </Group>

      <Group titleKey="doc_group_financial" count={analysis.financial.length}>
        {analysis.financial.map((f, i) => (
          <div key={i} className="rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <p className="text-sm font-medium break-words">{f.label}</p>
              {f.value ? <p className="text-sm break-words">{f.value}</p> : null}
            </div>
            <Quote quote={f.quote} page={f.page} />
          </div>
        ))}
      </Group>

      <Group titleKey="doc_group_deadlines" count={analysis.deadlines.length}>
        {analysis.deadlines.map((d, i) => (
          <div key={i} className="rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <p className="text-sm font-medium break-words">{d.label}</p>
              {d.value ? <p className="text-sm break-words">{d.value}</p> : null}
            </div>
            <Quote quote={d.quote} page={d.page} />
          </div>
        ))}
      </Group>

      <Group titleKey="doc_group_obligations" count={analysis.obligations.length}>
        {analysis.obligations.map((o, i) => (
          <div key={i} className="rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <Badge variant="secondary" className="font-normal">{t(`doc_party_${o.party.toLowerCase()}`)}</Badge>
              <p className="text-sm font-medium break-words">{o.label}</p>
            </div>
            {o.plain ? <p className="mt-1 text-sm break-words">{o.plain}</p> : null}
            <Quote quote={o.quote} page={o.page} />
          </div>
        ))}
      </Group>

      <Group titleKey="doc_group_missing" count={analysis.missingProtections.length}>
        {analysis.missingProtections.map((m, i) => (
          <div key={i} className="rounded-lg border border-border p-3">
            <p className="text-sm font-medium break-words">{m.label}</p>
            {m.plain ? <p className="mt-1 text-sm text-muted-foreground break-words">{m.plain}</p> : null}
          </div>
        ))}
      </Group>

      <Group titleKey="doc_group_clauses" count={ordinary.length}>
        {ordinary.map((c, i) => (
          <div key={i} className="rounded-lg border border-border p-3">
            <p className="text-sm font-medium break-words">{c.label}</p>
            {c.plain ? <p className="mt-1 text-sm break-words">{c.plain}</p> : null}
            <Quote quote={c.quote} page={c.page} />
          </div>
        ))}
      </Group>

      <Group titleKey="doc_group_questions" count={analysis.questions.length}>
        <ul className="space-y-1.5">
          {analysis.questions.map((q, i) => (
            <li key={i} className="text-sm break-words ps-4 relative">
              <span className="absolute start-0 top-[0.6em] h-1 w-1 rounded-full bg-muted-foreground/60" />
              {q}
            </li>
          ))}
        </ul>
      </Group>
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * The reader                                                          *
 * ------------------------------------------------------------------ */

export const DocumentReader: React.FC<{
  doc: WorkspaceDocument | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Where this document contributed to the verification (§21). */
  usedInVerification?: boolean;
}> = ({ doc, open, onOpenChange, usedInVerification }) => {
  const { t } = useLanguage();
  const [text, setText] = useState<{ text: string; pages: number | null } | null>(null);
  const [events, setEvents] = useState<DocumentEvent[] | null>(null);
  const [loadingText, setLoadingText] = useState(false);

  // Loaded when the reader opens, not with the list: a contract's full text
  // is tens of kilobytes per document.
  useEffect(() => {
    if (!open || !doc) return;
    let alive = true;
    setLoadingText(true);
    setText(null);
    setEvents(null);
    void (async () => {
      try {
        const [tx, ev] = await Promise.all([
          getExtractedText(doc.id),
          listDocumentEvents(doc.id).catch(() => [] as DocumentEvent[]),
        ]);
        if (!alive) return;
        setText(tx);
        setEvents(ev);
      } catch (e) {
        reportError(e, { subjectType: 'DOCUMENT', subjectId: doc.id, boundary: 'DocumentReader' });
        if (alive) setText({ text: '', pages: null });
      } finally {
        if (alive) setLoadingText(false);
      }
    })();
    return () => { alive = false; };
  }, [open, doc?.id]);

  if (!doc) return null;

  const counts = findingCounts(doc.analysis);

  const download = async () => {
    try {
      const url = await downloadUrlFor(doc);
      if (url) window.open(url, '_blank', 'noopener');
    } catch (e) {
      reportError(e, { subjectType: 'DOCUMENT', subjectId: doc.id, boundary: 'download' });
      toast.error(t('doc_download_failed'));
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* Wide, and full-width on a phone: this is a reading surface. */}
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="break-words pe-8">{doc.name}</SheetTitle>
        </SheetHeader>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-normal">{t(DOCUMENT_CATEGORY_KEY[doc.category])}</Badge>
          <Badge variant="outline" className="font-normal">{t(DOCUMENT_STATUS_KEY[doc.status])}</Badge>
          {usedInVerification ? (
            <Badge variant="secondary" className="font-normal">{t('doc_used_in_verification')}</Badge>
          ) : null}
        </div>

        <Tabs defaultValue="overview" className="mt-5">
          <TabsList className="w-full justify-start overflow-x-auto flex-nowrap">
            <TabsTrigger value="overview">{t('doc_tab_overview')}</TabsTrigger>
            <TabsTrigger value="analysis">{t('doc_tab_analysis')}</TabsTrigger>
            <TabsTrigger value="text">{t('doc_tab_text')}</TabsTrigger>
            <TabsTrigger value="details">{t('doc_tab_details')}</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-5 space-y-4">
            <SectionBoundary name="DocumentOverview" context={{ subjectType: 'DOCUMENT', subjectId: doc.id }}>
              {doc.analysis?.summary.length ? (
                <div className="space-y-2">
                  {doc.analysis.summary.map((s, i) => (
                    <p key={i} className="text-sm leading-relaxed break-words">{s}</p>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground break-words">{t('doc_reader_no_analysis')}</p>
              )}

              {counts.total > 0 ? (
                <p className="text-sm text-muted-foreground break-words">
                  {t('doc_counts').replace('{total}', String(counts.total)).replace('{attention}', String(counts.attention))}
                </p>
              ) : null}

              {/* A document that tried to instruct the model is a fact about
                  the document, and the buyer should know it. */}
              {doc.analysis?.containsInstructionLikeText ? (
                <p className="rounded-lg border border-amber-300/70 dark:border-amber-800 p-3 text-sm break-words">
                  {t('doc_instruction_like')}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <CopyButton
                  value={(doc.analysis?.summary ?? []).join('\n')}
                  label={t('doc_copy_summary')}
                />
                <Button variant="outline" size="sm" className="gap-2" onClick={download}>
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="break-words">{t('doc_download_original')}</span>
                </Button>
              </div>
            </SectionBoundary>
          </TabsContent>

          <TabsContent value="analysis" className="mt-5">
            <SectionBoundary name="DocumentAnalysis" context={{ subjectType: 'DOCUMENT', subjectId: doc.id }}>
              <AnalysisTab analysis={doc.analysis} />
            </SectionBoundary>
          </TabsContent>

          <TabsContent value="text" className="mt-5 space-y-3">
            <SectionBoundary name="DocumentText" context={{ subjectType: 'DOCUMENT', subjectId: doc.id }}>
              {loadingText ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-11/12" />
                  <Skeleton className="h-4 w-10/12" />
                </div>
              ) : text?.text ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <CopyButton value={text.text} label={t('doc_copy_text')} />
                    {text.pages ? (
                      <span className="text-sm text-muted-foreground">
                        {t('doc_pages').replace('{n}', String(text.pages))}
                      </span>
                    ) : null}
                  </div>
                  {/* Set for reading: a measure, real leading, and wrapping
                      that survives an unbroken Georgian compound. */}
                  <div className="rounded-xl border border-border bg-muted/20 p-4">
                    <p className="max-w-[68ch] whitespace-pre-wrap break-words text-[15px] leading-7">
                      {text.text}
                    </p>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground break-words">{t('doc_no_text')}</p>
              )}
            </SectionBoundary>
          </TabsContent>

          <TabsContent value="details" className="mt-5 space-y-5">
            <SectionBoundary name="DocumentDetails" context={{ subjectType: 'DOCUMENT', subjectId: doc.id }}>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Meta labelKey="doc_meta_filename" value={doc.originalFilename} />
                <Meta labelKey="doc_meta_type" value={doc.mimeType} />
                <Meta
                  labelKey="doc_meta_size"
                  value={doc.sizeBytes ? `${Math.max(1, Math.round(doc.sizeBytes / 1024))} KB` : null}
                />
                <Meta
                  labelKey="doc_meta_uploaded"
                  value={doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleString() : null}
                />
                <Meta
                  labelKey="doc_meta_analysed"
                  value={doc.analyzedAt ? new Date(doc.analyzedAt).toLocaleString() : null}
                />
                <Meta labelKey="doc_meta_pages" value={doc.extractedPages ? String(doc.extractedPages) : null} />
              </dl>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold break-words">{t('doc_tab_activity')}</h3>
                {events === null ? (
                  <Skeleton className="h-16 w-full" />
                ) : events.length === 0 ? (
                  <p className="text-sm text-muted-foreground break-words">{t('doc_no_activity')}</p>
                ) : (
                  <ol className="space-y-2">
                    {events.map((e) => (
                      <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                        <span className="break-words">{t(EVENT_KEY[e.eventType] ?? 'doc_event_other')}</span>
                        <span className="text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </SectionBoundary>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
};

const Meta: React.FC<{ labelKey: string; value: string | null }> = ({ labelKey, value }) => {
  const { t } = useLanguage();
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted-foreground break-words">{t(labelKey)}</dt>
      <dd className="text-sm break-words">{value}</dd>
    </div>
  );
};

export { FileText as DocumentIcon };
