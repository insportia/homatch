// HOMATCH — one document, as an object the customer controls (§7, §9, §16).
//
// COLLAPSED IS THE DEFAULT, AND THAT IS THE POINT
//
// The card answers, in one line each: what is this, what state is it in, what
// does it say, and how much did we find. That is everything needed to decide
// whether to open it — and nothing more, so ten documents stay a list rather
// than becoming a wall.
//
// The summary line is the analyser's own sentence, never the first line of
// the extracted text (§14). The first line of a Georgian sale agreement is a
// letterhead, and six cards showing six letterheads distinguish nothing.
//
// EXPANDED shows the structured findings in brief. The FULL READER is a
// separate, deliberate action, because reading a contract and scanning a list
// of contracts are different activities and the page cannot serve both at
// once.
//
// EVERY ACTION IN THE MENU IS REAL. Where one genuinely cannot work — asking
// us to re-read a scan that has no text layer — it is absent rather than
// present and disappointing.

import React, { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuLabel,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  FileText, MoreVertical, ChevronDown, ChevronRight, BookOpen, Pencil,
  RefreshCw, Download, Archive, ArchiveRestore, Trash2, Loader2,
  AlertTriangle, CheckCircle2, Tag,
} from 'lucide-react';
import {
  DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_KEY, DOCUMENT_STATUS_KEY,
  findingCounts, headlineFor, isDocumentBusy, DOCUMENT_FAILURE_KEY,
  type DocumentCategory,
} from '@/documents/documentModel';
import { canReanalyze, type WorkspaceDocument } from '@/services/documentWorkspace';
import type { BackgroundJob } from '@/services/backgroundJobs';
import { cancelSecondsRemaining } from '@/jobs/jobState';

export interface DocumentCardActions {
  onOpenReader: (doc: WorkspaceDocument) => void;
  onRename: (doc: WorkspaceDocument, name: string) => Promise<void>;
  onCategorize: (doc: WorkspaceDocument, c: DocumentCategory) => Promise<void>;
  onReanalyze: (doc: WorkspaceDocument) => Promise<void>;
  onArchive: (doc: WorkspaceDocument) => Promise<void>;
  onRestore: (doc: WorkspaceDocument) => Promise<void>;
  onDelete: (doc: WorkspaceDocument) => Promise<void>;
  onDownload: (doc: WorkspaceDocument) => Promise<void>;
  onCancelJob?: (jobId: string) => Promise<void>;
}

const StatusIcon: React.FC<{ doc: WorkspaceDocument }> = ({ doc }) => {
  if (isDocumentBusy(doc.status)) {
    return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />;
  }
  if (doc.status === 'FAILED') {
    return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />;
  }
  if (doc.status === 'READY') {
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />;
  }
  return <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
};

export const DocumentCard: React.FC<{
  doc: WorkspaceDocument;
  job?: BackgroundJob | null;
  expanded: boolean;
  onToggle: () => void;
  actions: DocumentCardActions;
  busy?: boolean;
  usedInVerification?: boolean;
}> = ({ doc, job, expanded, onToggle, actions, busy, usedInVerification }) => {
  const { t } = useLanguage();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(doc.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [working, setWorking] = useState(false);

  const counts = findingCounts(doc.analysis);
  const headline = headlineFor({ storedHeadline: doc.headlineSummary, analysis: doc.analysis });
  const disabled = busy || working;

  const run = async (fn: () => Promise<void>) => {
    setWorking(true);
    try { await fn(); } finally { setWorking(false); }
  };

  const submitRename = async () => {
    const name = draft.trim();
    setRenaming(false);
    if (!name || name === doc.name) return;
    await run(() => actions.onRename(doc, name));
  };

  const cancelSeconds = job?.canCancel ? cancelSecondsRemaining(job.cancelDeadlineAt) : 0;

  return (
    <Card className={doc.status === 'ARCHIVED' ? 'opacity-70' : undefined}>
      <CardContent className="pt-4 pb-4 space-y-3">
        {/* ── Collapsed row ─────────────────────────────────── */}
        <div className="flex items-start gap-2.5">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={t(expanded ? 'doc_collapse' : 'doc_expand')}
            className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            {expanded
              ? <ChevronDown className="h-4 w-4" aria-hidden="true" />
              : <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />}
          </button>

          <StatusIcon doc={doc} />

          <div className="min-w-0 flex-1 space-y-1">
            {renaming ? (
              <Input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={submitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitRename();
                  if (e.key === 'Escape') { setDraft(doc.name); setRenaming(false); }
                }}
                aria-label={t('doc_action_rename')}
                className="h-8"
              />
            ) : (
              // A long Georgian filename must wrap, not push the card sideways.
              <p className="text-sm font-medium break-words">{doc.name}</p>
            )}

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Badge variant="outline" className="font-normal">{t(DOCUMENT_CATEGORY_KEY[doc.category])}</Badge>
              <Badge variant="outline" className="font-normal">{t(DOCUMENT_STATUS_KEY[doc.status])}</Badge>
              {doc.sizeBytes ? (
                <span className="text-sm text-muted-foreground">
                  {Math.max(1, Math.round(doc.sizeBytes / 1024))} KB
                </span>
              ) : null}
              {doc.uploadedAt ? (
                <span className="text-sm text-muted-foreground">
                  {new Date(doc.uploadedAt).toLocaleDateString()}
                </span>
              ) : null}
              {counts.total > 0 ? (
                <span className="text-sm text-muted-foreground">
                  {t('doc_findings_count').replace('{n}', String(counts.total))}
                </span>
              ) : null}
              {counts.attention > 0 ? (
                <Badge variant="secondary" className="font-normal">
                  {t('doc_attention_count').replace('{n}', String(counts.attention))}
                </Badge>
              ) : null}
              {usedInVerification ? (
                <Badge variant="secondary" className="font-normal">{t('doc_used_in_verification')}</Badge>
              ) : null}
            </div>

            {/* The human sentence. Never raw extracted text. */}
            {headline ? (
              <p className="text-sm text-muted-foreground leading-relaxed break-words">{headline}</p>
            ) : null}

            {/* A truthful stage line while work is happening (§10, §11). */}
            {isDocumentBusy(doc.status) ? (
              <p className="text-sm text-muted-foreground break-words">
                {t(job?.currentStage === 'ANALYZING' ? 'doc_status_analyzing' : DOCUMENT_STATUS_KEY[doc.status])}
              </p>
            ) : null}

            {doc.status === 'FAILED' ? (
              <p className="text-sm text-amber-700 dark:text-amber-400 break-words">
                {t(DOCUMENT_FAILURE_KEY[doc.analysisState.toUpperCase()] ?? 'doc_error_failed')}
              </p>
            ) : null}
          </div>

          {/* ── Actions ─────────────────────────────────────── */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" disabled={disabled} aria-label={t('doc_actions')}>
                <MoreVertical className="h-4 w-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => actions.onOpenReader(doc)}>
                <BookOpen className="h-4 w-4 me-2" aria-hidden="true" />
                {t('doc_action_open')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onToggle}>
                {expanded
                  ? <ChevronDown className="h-4 w-4 me-2" aria-hidden="true" />
                  : <ChevronRight className="h-4 w-4 me-2 rtl:rotate-180" aria-hidden="true" />}
                {t(expanded ? 'doc_collapse' : 'doc_expand')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setDraft(doc.name); setRenaming(true); }}>
                <Pencil className="h-4 w-4 me-2" aria-hidden="true" />
                {t('doc_action_rename')}
              </DropdownMenuItem>

              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Tag className="h-4 w-4 me-2" aria-hidden="true" />
                  {t('doc_action_categorize')}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={doc.category}
                    onValueChange={(v) => void run(() => actions.onCategorize(doc, v as DocumentCategory))}
                  >
                    {DOCUMENT_CATEGORIES.map((c) => (
                      <DropdownMenuRadioItem key={c} value={c}>
                        {t(DOCUMENT_CATEGORY_KEY[c])}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSeparator />

              {/* Absent, not disabled, when it cannot honestly work. */}
              {canReanalyze(doc) ? (
                <DropdownMenuItem onClick={() => void run(() => actions.onReanalyze(doc))}>
                  <RefreshCw className="h-4 w-4 me-2" aria-hidden="true" />
                  {t(doc.status === 'FAILED' ? 'doc_action_retry' : 'doc_action_reanalyze')}
                </DropdownMenuItem>
              ) : null}

              <DropdownMenuItem onClick={() => void run(() => actions.onDownload(doc))}>
                <Download className="h-4 w-4 me-2" aria-hidden="true" />
                {t('doc_download_original')}
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              {/* Archive leads. Delete is not the normal way to remove
                  something the customer owns (§19). */}
              {doc.status === 'ARCHIVED' ? (
                <DropdownMenuItem onClick={() => void run(() => actions.onRestore(doc))}>
                  <ArchiveRestore className="h-4 w-4 me-2" aria-hidden="true" />
                  {t('doc_action_restore')}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => void run(() => actions.onArchive(doc))}>
                  <Archive className="h-4 w-4 me-2" aria-hidden="true" />
                  {t('doc_action_archive')}
                </DropdownMenuItem>
              )}

              <DropdownMenuLabel className="pt-2 text-sm font-normal text-muted-foreground">
                {t('doc_delete_note')}
              </DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => setConfirmDelete(true)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4 me-2" aria-hidden="true" />
                {t('doc_action_delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* The fifteen-second window, if this analysis has just been asked for. */}
        {job?.canCancel && cancelSeconds > 0 && actions.onCancelJob ? (
          <Button
            variant="outline"
            size="sm"
            className="w-full sm:w-auto gap-2"
            disabled={disabled}
            onClick={() => void run(() => actions.onCancelJob!(job.id))}
          >
            {t('job_cancel_action')}
            <span className="tabular-nums text-muted-foreground">
              {t('job_cancel_seconds').replace('{s}', String(cancelSeconds))}
            </span>
          </Button>
        ) : null}

        {/* ── Expanded ──────────────────────────────────────── */}
        {expanded ? (
          <div className="ps-9 space-y-3 border-t border-border pt-3">
            {doc.analysis ? (
              <>
                {doc.analysis.summary.length > 1 ? (
                  <div className="space-y-1.5">
                    {doc.analysis.summary.slice(1, 4).map((s, i) => (
                      <p key={i} className="text-sm leading-relaxed break-words">{s}</p>
                    ))}
                  </div>
                ) : null}

                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <Stat labelKey="doc_group_clauses" n={doc.analysis.clauses.length} />
                  <Stat labelKey="doc_group_financial" n={doc.analysis.financial.length} />
                  <Stat labelKey="doc_group_deadlines" n={doc.analysis.deadlines.length} />
                  <Stat labelKey="doc_group_obligations" n={doc.analysis.obligations.length} />
                </dl>

                {/* Deliberately a door, not the content. The full text and the
                    full findings live in the reader. */}
                <Button variant="outline" size="sm" className="w-full sm:w-auto gap-2" onClick={() => actions.onOpenReader(doc)}>
                  <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('doc_action_open')}
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground break-words">
                {t(isDocumentBusy(doc.status) ? 'doc_reader_pending' : 'doc_reader_no_analysis')}
              </p>
            )}
          </div>
        ) : null}
      </CardContent>

      {/* Permanent deletion is explicitly confirmed and says what it costs. */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="break-words">{t('doc_delete_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              {t('doc_delete_confirm_body')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('doc_delete_cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void run(() => actions.onDelete(doc))}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('doc_delete_confirm_action')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};

const Stat: React.FC<{ labelKey: string; n: number }> = ({ labelKey, n }) => {
  const { t } = useLanguage();
  if (!n) return null;
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted-foreground break-words">{t(labelKey)}</dt>
      <dd className="text-sm font-medium tabular-nums">{n}</dd>
    </div>
  );
};
