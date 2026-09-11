// HOMATCH — one VERIFICATION CASE: the persistent workspace for one property.
//
// This is the screen the whole product converges on, and it opens from the
// Verification Center — it is not a second product beside Verify. Everything
// a buyer has about this property lives here: the summary, what to do, their
// documents, their questions, and the assistant that can answer using all of
// it.
//
// It is organised as a small number of tabs rather than dozens of cards. A
// buyer thinks in questions ("what did you find", "what do I do", "what does
// my contract say"), so the tabs are those questions.
//
// The storage layer underneath still calls a case a `deal_room` (see
// services/dealRooms.ts for why those live production tables were not
// renamed); nothing on this screen does.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { useLanguage } from '@/contexts/LanguageContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { supabase } from '@/db/supabase';
import {
  getDealRoom, listActionItems, listQuestions, listDocuments, listNotes,
  setActionState, answerQuestion, addNote, loadLatestAiThread,
  type DealRoomRecord, type ActionItemRecord, type QuestionRecord, type DocumentRecord,
} from '@/services/dealRooms';
import { listFindings, uploadDocument, type DocumentFinding } from '@/services/dealRoomDocuments';
import {
  listWorkspaceDocuments, renameDocument, setDocumentCategory, archiveDocument,
  restoreDocument, deleteDocumentPermanently, downloadUrlFor, requestAnalysis,
  type WorkspaceDocument,
} from '@/services/documentWorkspace';
import { DocumentWorkspace } from '@/components/documents/DocumentWorkspace';
import { DocumentReader } from '@/components/documents/DocumentReader';
import type { DocumentCategory } from '@/documents/documentModel';
import { useJobs } from '@/contexts/JobsContext';
import type { BackgroundJob } from '@/services/backgroundJobs';
import { VerifyResultView } from '@/components/verify/VerifyResultView';
import { loadVerifyResult, getVerifyJobFacts, type VerifyJobFacts } from '@/services/verifyResult';
import type { NormalizedVerifyResult } from '@/verify/resultNormalizer';
import { isTerminal } from '@/jobs/jobState';
import { ActionPlanPanel } from '@/components/dealroom/ActionPlanPanel';
import { AskHomatchPanel, type AskMessage } from '@/components/dealroom/AskHomatchPanel';

const VerificationCasePage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { t } = useLanguage();
  const navigate = useNavigate();
  // `?tab=documents` is how the Center's contract upload lands the customer
  // on the document they just chose rather than on a summary that has not
  // been produced yet. An unknown value falls back to the summary.
  const [searchParams] = useSearchParams();
  const requested = searchParams.get('tab');
  const initialTab = ['summary', 'plan', 'documents', 'ask', 'notes'].includes(requested ?? '')
    ? (requested as string)
    : 'summary';

  const [room, setRoom] = useState<DealRoomRecord | null | undefined>(undefined);
  const [actions, setActions] = useState<ActionItemRecord[]>([]);
  const [questions, setQuestions] = useState<QuestionRecord[]>([]);
  // One read gives the whole document: its analysis, its category, its
  // archive state. The old page fetched the list and then made one extra
  // round trip PER DOCUMENT to find out whether it had been analysed.
  const [documents, setDocuments] = useState<WorkspaceDocument[]>([]);
  const [findings, setFindings] = useState<DocumentFinding[]>([]);
  const [readerDoc, setReaderDoc] = useState<WorkspaceDocument | null>(null);
  const [readerOpen, setReaderOpen] = useState(false);
  const [notes, setNotes] = useState<{ id: string; body: string; created_at: string }[]>([]);
  const [noteDraft, setNoteDraft] = useState('');

  // The verification result, already canonicalised. The page never holds a
  // raw synthesis payload, which is what made two renderers disagree about
  // its shape and crash this screen.
  const [verifyResult, setVerifyResult] = useState<NormalizedVerifyResult | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [verifyFacts, setVerifyFacts] = useState<VerifyJobFacts | null>(null);

  const [messages, setMessages] = useState<AskMessage[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [askBusy, setAskBusy] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /*
   * The live document jobs, from the global provider.
   *
   * Read rather than owned: the provider is mounted above the router, so a
   * document analysis the customer started here keeps being watched after
   * they navigate away — and is still being watched when they come back
   * (§30, §31).
   */
  const { jobs: allJobs, cancel: cancelJob, refresh: refreshJobs } = useJobs();
  const documentJobs = useMemo(() => {
    const m = new Map<string, BackgroundJob>();
    for (const j of allJobs) {
      if (j.subjectType === 'DOCUMENT' && j.subjectId) m.set(j.subjectId, j);
    }
    return m;
  }, [allJobs]);

  /*
   * PROVENANCE (§21).
   *
   * A document that produced a finding which was cross-checked against the
   * verification contributed to it. Derived from the findings themselves
   * rather than asserted, so the badge can never claim a document was used
   * when nothing of it reached the report.
   */
  const usedInVerification = useMemo(() => {
    const ids = new Set<string>();
    for (const f of findings) {
      if (f.verify_relation === 'AGREES' || f.verify_relation === 'CONTRADICTS') {
        const docId = (f as unknown as { document_id?: string }).document_id;
        if (docId) ids.add(docId);
      }
    }
    return ids;
  }, [findings]);

  const reload = useCallback(async () => {
    if (!id) return;
    const r = await getDealRoom(id);
    setRoom(r);
    if (!r) return;
    const [a, q, d, f, n, ai] = await Promise.all([
      listActionItems(id), listQuestions(id), listWorkspaceDocuments(id), listFindings(id),
      listNotes(id), loadLatestAiThread(id),
    ]);
    setActions(a);
    setQuestions(q);
    setDocuments(d);
    setFindings(f);
    setNotes(n);
    // The conversation continues where the customer left it, days later. An
    // empty grounded_in is preserved as an empty array, because that is what
    // labels a past answer as a general explanation rather than a property
    // fact — defaulting it to something else would relabel history.
    setThreadId(ai.threadId);
    setMessages(
      ai.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        grounded: Array.isArray(m.grounded_in) ? m.grounded_in : [],
      }))
    );
  }, [id]);

  useEffect(() => {
    reload().catch(() => setRoom(null));
  }, [reload]);

  /*
   * The verification result.
   *
   * Separate from reload() because it may involve a model round-trip and the
   * rest of the case must not wait on it. Canonicalised on the way in by
   * loadVerifyResult(), so what lands in state is always the same shape
   * whichever of the three historical payload contracts the row was written
   * in — that disagreement is what used to crash this screen.
   *
   * WHILE THE RESEARCH IS STILL RUNNING it re-reads on a timer, so a customer
   * who opens the case mid-run watches it fill in rather than being told to
   * come back. `alive` only stops US from writing into an unmounted
   * component's state — it does not, and must not, stop the verification
   * (PART C §30/§50).
   */
  useEffect(() => {
    const jobId = room?.verify_job_id;
    if (!jobId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setSummaryLoading(true);

    const tick = async () => {
      try {
        const facts = await getVerifyJobFacts(jobId);
        if (!alive) return;
        setVerifyFacts(facts);
        const next = await loadVerifyResult(jobId);
        if (!alive) return;
        setVerifyResult(next);
        // A terminal result never changes again; anything else is worth
        // another look. The interval is deliberately unhurried — the durable
        // driver is what advances the work, not this poll.
        if (!isTerminal(next.state)) timer = setTimeout(tick, 5000);
      } finally {
        if (alive) setSummaryLoading(false);
      }
    };

    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [room?.verify_job_id]);

  const onToggle = async (item: ActionItemRecord, next: ActionItemRecord['state']) => {
    setBusy(true);
    // Optimistic: the customer's own progress should feel instant.
    setActions((prev) => prev.map((a) => (a.id === item.id ? { ...a, state: next } : a)));
    try {
      await setActionState(item.id, next);
    } catch {
      setActions((prev) => prev.map((a) => (a.id === item.id ? { ...a, state: item.state } : a)));
      toast.error(t('dr_error_generic'));
    } finally {
      setBusy(false);
    }
  };

  const onAnswer = async (q: QuestionRecord, answer: string) => {
    setBusy(true);
    try {
      await answerQuestion(q.id, answer);
      setQuestions((prev) => prev.map((x) => (x.id === q.id ? { ...x, answer, asked: true } : x)));
    } catch {
      toast.error(t('dr_error_generic'));
    } finally {
      setBusy(false);
    }
  };

  /*
   * Uploading now ASKS for the document to be read, durably.
   *
   * It used to upload and stop: the customer then had to find and press
   * Analyse. Handing us a contract is unambiguous about what they want, and
   * the analysis is a registered job from the first moment, so leaving the
   * page immediately afterwards is safe.
   */
  const onUpload = async (file: File) => {
    if (!id) return;
    setBusy(true);
    try {
      const { documentId } = await uploadDocument({ roomId: id, file });
      toast.success(t('dr_docs_uploaded'));
      await requestAnalysis({ id: documentId, caseId: id, name: file.name } as WorkspaceDocument);
      await reload();
      await refreshJobs();
    } catch {
      toast.error(t('dr_error_generic'));
    } finally {
      setBusy(false);
    }
  };

  /*
   * WHAT THE WORKSPACE CAN DO.
   *
   * Each of these re-reads afterwards rather than patching local state: the
   * database is the authority on what happened, and a card that shows an
   * archive that failed is worse than one that takes a moment to update.
   */
  const guard = async (fn: () => Promise<void>) => {
    try {
      await fn();
      await reload();
    } catch {
      toast.error(t('dr_error_generic'));
      await reload();
    }
  };

  const documentActions = {
    onOpenReader: (doc: WorkspaceDocument) => { setReaderDoc(doc); setReaderOpen(true); },
    onRename: (doc: WorkspaceDocument, name: string) => guard(() => renameDocument(doc, name)),
    onCategorize: (doc: WorkspaceDocument, c: DocumentCategory) => guard(() => setDocumentCategory(doc, c)),
    onReanalyze: (doc: WorkspaceDocument) =>
      guard(async () => { await requestAnalysis(doc, { reanalyze: true }); await refreshJobs(); }),
    onArchive: (doc: WorkspaceDocument) => guard(() => archiveDocument(doc)),
    onRestore: (doc: WorkspaceDocument) => guard(() => restoreDocument(doc)),
    onDelete: (doc: WorkspaceDocument) => guard(() => deleteDocumentPermanently(doc)),
    onDownload: async (doc: WorkspaceDocument) => {
      try {
        const url = await downloadUrlFor(doc);
        if (url) window.open(url, '_blank', 'noopener');
      } catch {
        toast.error(t('doc_download_failed'));
      }
    },
    onCancelJob: async (jobId: string) => {
      const outcome = await cancelJob(jobId);
      if (!outcome.ok && outcome.reason === 'COMMITTED') toast.info(t('job_cancel_too_late'));
      await reload();
    },
  };

  const onAsk = async (question: string) => {
    if (!id) return;
    const localId = `local-${Date.now()}`;
    setMessages((m) => [...m, { id: localId, role: 'user', content: question, grounded: [] }]);
    setAskBusy(true);
    setAskError(null);
    try {
      const { data, error } = await supabase.functions.invoke('deal-room-ai', {
        body: { caseId: id, question, threadId },
      });
      if (error || !data || data.error || !data.answer) {
        setAskError(t('dr_ask_unavailable'));
        return;
      }
      if (data.threadId) setThreadId(data.threadId as string);
      setMessages((m) => [
        ...m,
        { id: `${localId}-a`, role: 'assistant', content: data.answer, grounded: data.grounded ?? [] },
      ]);
    } catch {
      setAskError(t('dr_ask_unavailable'));
    } finally {
      setAskBusy(false);
    }
  };

  const onAddNote = async () => {
    if (!id || !noteDraft.trim()) return;
    setBusy(true);
    try {
      await addNote(id, noteDraft);
      setNoteDraft('');
      setNotes(await listNotes(id));
    } catch {
      toast.error(t('dr_error_generic'));
    } finally {
      setBusy(false);
    }
  };

  if (room === undefined) {
    return (
      <AppLayout>
        <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-32 w-full" />
        </div>
      </AppLayout>
    );
  }

  if (room === null) {
    return (
      <AppLayout>
        <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">
          <p className="text-sm text-muted-foreground">{t('dr_not_found')}</p>
          <Button variant="outline" onClick={() => navigate('/verify')} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            {t('vc_center_title')}
          </Button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto px-4 py-6 sm:py-8 space-y-5">
        <div className="space-y-2">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 -ml-2"
            onClick={() => navigate('/verify')}
          >
            <ArrowLeft className="h-4 w-4" />
            {t('vc_center_title')}
          </Button>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight break-words">
            {room.title || room.address || room.cadastral_code}
          </h1>
          {room.cadastral_code ? (
            <p className="text-sm text-muted-foreground break-words">{room.cadastral_code}</p>
          ) : null}
        </div>

        <Tabs defaultValue={initialTab}>
          {/* Horizontally scrollable on narrow screens rather than wrapping
              into two rows, which would push content below the fold at 320px. */}
          <TabsList className="w-full justify-start overflow-x-auto flex-nowrap">
            <TabsTrigger value="summary">{t('dr_tab_summary')}</TabsTrigger>
            <TabsTrigger value="plan">{t('dr_tab_plan')}</TabsTrigger>
            <TabsTrigger value="documents">{t('dr_tab_documents')}</TabsTrigger>
            <TabsTrigger value="ask">{t('dr_tab_ask')}</TabsTrigger>
            <TabsTrigger value="notes">{t('dr_tab_notes')}</TabsTrigger>
          </TabsList>

          <TabsContent value="summary" className="mt-5">
            <VerifyResultView
              normalized={verifyResult}
              initialLoading={summaryLoading && !verifyResult}
              stage={verifyFacts?.stage ?? null}
              status={verifyFacts?.status ?? null}
              createdAt={verifyFacts?.createdAt ?? null}
              completedAt={verifyFacts?.completedAt ?? null}
              subjectId={room.verify_job_id}
              onRetry={room.verify_job_id ? () => navigate(`/verify?job=${room.verify_job_id}`) : undefined}
            />
          </TabsContent>

          <TabsContent value="plan" className="mt-5">
            <ActionPlanPanel
              actions={actions}
              questions={questions}
              onToggle={onToggle}
              onAnswer={onAnswer}
              busy={busy}
            />
          </TabsContent>

          <TabsContent value="documents" className="mt-5">
            <DocumentWorkspace
              documents={documents}
              findings={findings}
              jobs={documentJobs}
              onUpload={onUpload}
              actions={documentActions}
              busy={busy}
              usedInVerification={usedInVerification}
            />
          </TabsContent>

          <TabsContent value="ask" className="mt-5">
            <AskHomatchPanel messages={messages} onAsk={onAsk} busy={askBusy} error={askError} />
          </TabsContent>

          <TabsContent value="notes" className="mt-5 space-y-4">
            <Card>
              <CardContent className="pt-5 space-y-3">
                <Textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder={t('dr_notes_placeholder')}
                  rows={3}
                  aria-label={t('dr_notes_placeholder')}
                />
                <Button
                  onClick={onAddNote}
                  disabled={busy || !noteDraft.trim()}
                  className="w-full sm:w-auto"
                >
                  {t('dr_notes_add')}
                </Button>
              </CardContent>
            </Card>

            {notes.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('dr_notes_empty')}</p>
            ) : (
              <div className="space-y-3">
                {notes.map((n) => (
                  <Card key={n.id}>
                    <CardContent className="pt-4">
                      <p className="text-sm whitespace-pre-wrap break-words">{n.body}</p>
                      <p className="text-xs text-muted-foreground mt-2">
                        {new Date(n.created_at).toLocaleString()}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Outside the tab strip on purpose: closing the reader must not move
          the customer somewhere else. */}
      <DocumentReader
        doc={readerDoc}
        open={readerOpen}
        onOpenChange={setReaderOpen}
        usedInVerification={readerDoc ? usedInVerification.has(readerDoc.id) : false}
      />
    </AppLayout>
  );
};

export default VerificationCasePage;
