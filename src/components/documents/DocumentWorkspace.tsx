// HOMATCH — the document workspace (§6, §12, §13).
//
// WHAT THIS REPLACES
//
// DocumentsPanel: an upload button, a flat list of filenames with a bin icon
// each, and every analysed document's full contract analysis rendered inline
// and permanently expanded underneath it. Two contracts made the tab
// unreadable. There was no way to search, no way to group, no way to collapse
// anything, and the only action on a document you owned was to destroy it.
//
// The rules here:
//
//   Finished documents start COLLAPSED. A list is for choosing; the reader
//   is for reading.
//   Anything still working starts EXPANDED, because that is the one the
//   customer is waiting on.
//   Archived documents are hidden behind a count, not deleted and not mixed in.
//
// GROUPING is by category and appears only when it earns its place: with
// three documents in two groups, headings are noise. The threshold is a
// judgement, not a setting — a control to turn grouping on and off would be
// one more decision to hand a customer who wanted to read a contract.

import React, { useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Upload, ChevronsDownUp, ChevronsUpDown, Search, Scale, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { ALLOWED_MIME, validateUpload } from '@/services/dealRoomDocuments';
import type { DocumentFinding } from '@/services/dealRoomDocuments';
import type { WorkspaceDocument } from '@/services/documentWorkspace';
import type { BackgroundJob } from '@/services/backgroundJobs';
import {
  DOCUMENT_CATEGORY_KEY, filterDocuments, sortDocuments,
  type DocumentSort, type DocumentCategory,
} from '@/documents/documentModel';
import { DocumentCard, type DocumentCardActions } from './DocumentCard';
import { SectionBoundary } from '@/components/common/SectionBoundary';

const REJECTION_KEY: Record<string, string> = {
  TOO_LARGE: 'dr_docs_too_large',
  UNSUPPORTED_TYPE: 'dr_docs_bad_type',
  SUSPICIOUS_NAME: 'dr_docs_bad_name',
  EMPTY: 'dr_docs_bad_type',
};

/** Below this, headings cost more than they organise. */
const GROUPING_THRESHOLD = 4;

export const DocumentWorkspace: React.FC<{
  documents: WorkspaceDocument[];
  findings: DocumentFinding[];
  jobs: Map<string, BackgroundJob>;
  onUpload: (file: File) => void;
  actions: DocumentCardActions;
  busy?: boolean;
  /** Ids that contributed to the verification result (§21). */
  usedInVerification?: Set<string>;
}> = ({ documents, findings, jobs, onUpload, actions, busy, usedInVerification }) => {
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<DocumentSort>('NEWEST');
  const [showArchived, setShowArchived] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  /** Null until the customer expresses a preference, so the default below
   *  (working documents open, finished ones closed) survives a re-render
   *  without fighting an explicit Collapse all. */
  const [bulk, setBulk] = useState<'ALL' | 'NONE' | null>(null);

  const pick = (file: File | undefined) => {
    if (!file) return;
    // Checked here so the customer gets an understandable reason immediately
    // rather than a storage error from the network layer.
    const v = validateUpload({ name: file.name, size: file.size, type: file.type });
    if (!v.ok) {
      setRejection(REJECTION_KEY[v.reason] ?? 'dr_docs_bad_type');
      return;
    }
    setRejection(null);
    onUpload(file);
  };

  const active = documents.filter((d) => d.status !== 'ARCHIVED');
  const archived = documents.filter((d) => d.status === 'ARCHIVED');
  const pool = showArchived ? documents : active;

  const visible = useMemo(() => {
    const filtered = filterDocuments(
      pool.map((d) => ({ ...d, headline: d.headlineSummary })),
      query
    );
    return sortDocuments(filtered, sort) as WorkspaceDocument[];
  }, [pool, query, sort]);

  const isExpanded = (d: WorkspaceDocument): boolean => {
    if (expanded.has(d.id)) return true;
    if (bulk === 'ALL') return true;
    if (bulk === 'NONE') return false;
    // The default: the one being worked on is the one you want open.
    return d.status !== 'READY' && d.status !== 'ARCHIVED';
  };

  const toggle = (id: string) => {
    setBulk(null);
    setExpanded((cur) => {
      const next = new Set(cur);
      // Re-deriving from what is currently ON SCREEN, so a toggle after
      // "expand all" closes that one card rather than silently doing nothing.
      const currentlyOpen = new Set(visible.filter(isExpanded).map((d) => d.id));
      currentlyOpen.has(id) ? currentlyOpen.delete(id) : currentlyOpen.add(id);
      next.clear();
      for (const x of currentlyOpen) next.add(x);
      return next;
    });
  };

  const contradictions = findings.filter((f) => f.verify_relation === 'CONTRADICTS');
  const agreements = findings.filter((f) => f.verify_relation === 'AGREES');

  const grouped = useMemo(() => {
    if (visible.length < GROUPING_THRESHOLD) return null;
    const map = new Map<DocumentCategory, WorkspaceDocument[]>();
    for (const d of visible) {
      const list = map.get(d.category) ?? [];
      list.push(d);
      map.set(d.category, list);
    }
    return map.size > 1 ? map : null;
  }, [visible]);

  const renderCard = (d: WorkspaceDocument) => (
    <DocumentCard
      key={d.id}
      doc={d}
      job={jobs.get(d.id) ?? null}
      expanded={isExpanded(d)}
      onToggle={() => toggle(d.id)}
      actions={actions}
      busy={busy}
      usedInVerification={usedInVerification?.has(d.id)}
    />
  );

  return (
    <div className="space-y-4">
      {/* ── Upload ────────────────────────────────────────── */}
      <Card>
        <CardContent className="pt-5 space-y-3">
          <input
            ref={inputRef}
            type="file"
            accept={ALLOWED_MIME.join(',')}
            className="hidden"
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <Button onClick={() => inputRef.current?.click()} disabled={busy} className="w-full sm:w-auto gap-2">
            <Upload className="h-4 w-4" aria-hidden="true" />
            {t('dr_docs_upload')}
          </Button>
          <p className="text-sm text-muted-foreground leading-relaxed break-words">{t('dr_docs_hint')}</p>
          {rejection ? <p className="text-sm text-destructive break-words">{t(rejection)}</p> : null}
        </CardContent>
      </Card>

      {/* ── What the documents disagree with ──────────────── */}
      {contradictions.length > 0 ? (
        <SectionBoundary name="DocumentContradictions">
          <Card className="border-amber-300 dark:border-amber-800">
            <CardContent className="pt-5 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2 break-words">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                {t('dr_docs_contradicts')}
              </h3>
              {contradictions.map((f) => <FindingRow key={f.id} finding={f} />)}
            </CardContent>
          </Card>
        </SectionBoundary>
      ) : null}

      {agreements.length > 0 ? (
        <SectionBoundary name="DocumentAgreements">
          <Card>
            <CardContent className="pt-5 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2 break-words">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                {t('dr_docs_agrees')}
              </h3>
              {agreements.map((f) => <FindingRow key={f.id} finding={f} />)}
            </CardContent>
          </Card>
        </SectionBoundary>
      ) : null}

      {/* ── The list ──────────────────────────────────────── */}
      {documents.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground break-words">{t('dr_docs_empty')}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Controls appear only once there is enough to control. */}
          {documents.length > 1 ? (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <div className="relative flex-1 min-w-0">
                <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('doc_search_placeholder')}
                  aria-label={t('doc_search_placeholder')}
                  className="ps-9"
                />
              </div>
              <Select value={sort} onValueChange={(v) => setSort(v as DocumentSort)}>
                <SelectTrigger className="w-full sm:w-44" aria-label={t('doc_sort_label')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NEWEST">{t('doc_sort_newest')}</SelectItem>
                  <SelectItem value="OLDEST">{t('doc_sort_oldest')}</SelectItem>
                  <SelectItem value="NAME">{t('doc_sort_name')}</SelectItem>
                  <SelectItem value="STATUS">{t('doc_sort_status')}</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                className="w-full sm:w-auto gap-2"
                onClick={() => { setExpanded(new Set()); setBulk(bulk === 'ALL' ? 'NONE' : 'ALL'); }}
              >
                {bulk === 'ALL'
                  ? <ChevronsDownUp className="h-4 w-4" aria-hidden="true" />
                  : <ChevronsUpDown className="h-4 w-4" aria-hidden="true" />}
                <span className="break-words">{t(bulk === 'ALL' ? 'doc_collapse_all' : 'doc_expand_all')}</span>
              </Button>
            </div>
          ) : null}

          {visible.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground break-words">{t('doc_no_matches')}</p>
              </CardContent>
            </Card>
          ) : grouped ? (
            <div className="space-y-5">
              {[...grouped.entries()].map(([category, docs]) => (
                <section key={category} className="space-y-2.5">
                  <h3 className="flex items-center gap-2 text-sm font-semibold break-words">
                    {t(DOCUMENT_CATEGORY_KEY[category])}
                    <Badge variant="outline" className="font-normal">{docs.length}</Badge>
                  </h3>
                  <div className="space-y-2.5">{docs.map(renderCard)}</div>
                </section>
              ))}
            </div>
          ) : (
            <div className="space-y-2.5">{visible.map(renderCard)}</div>
          )}

          {archived.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="w-full sm:w-auto"
              onClick={() => setShowArchived((v) => !v)}
            >
              {t(showArchived ? 'doc_hide_archived' : 'doc_show_archived').replace('{n}', String(archived.length))}
            </Button>
          ) : null}
        </>
      )}

      <p className="flex gap-2 text-sm text-muted-foreground leading-relaxed">
        <Scale className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
        <span className="min-w-0 break-words">{t('dr_docs_legal_note')}</span>
      </p>
    </div>
  );
};

const FindingRow: React.FC<{ finding: DocumentFinding }> = ({ finding }) => (
  <div className="text-sm space-y-1">
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="font-medium break-words">{finding.label}</span>
      {finding.value ? <span className="break-words">{finding.value}</span> : null}
      {finding.severity === 'IMPORTANT' ? <Badge variant="destructive">!</Badge> : null}
    </div>
    {/* The quote is the provenance. A finding that cannot point at the text it
        came from is not shown as a contract fact at all. */}
    {finding.quote ? (
      <blockquote className="border-s-2 ps-3 text-sm text-muted-foreground break-words">
        {finding.quote}
        {finding.page ? ` (p. ${finding.page})` : ''}
      </blockquote>
    ) : null}
  </div>
);
