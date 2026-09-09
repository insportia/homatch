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
import React, { useCallback, useEffect, useState } from 'react';
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
import { listFindings, uploadDocument, deleteDocument, analyzeDocument, getDocumentAnalysis,
  type DocumentFinding, type AnalysisState, type DocumentAnalysis } from '@/services/dealRoomDocuments';
import { SynthesisSummary, type SynthesisView } from '@/components/dealroom/SynthesisSummary';
import { ActionPlanPanel } from '@/components/dealroom/ActionPlanPanel';
import { AskHomatchPanel, type AskMessage } from '@/components/dealroom/AskHomatchPanel';
import { DocumentsPanel } from '@/components/dealroom/DocumentsPanel';

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
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [findings, setFindings] = useState<DocumentFinding[]>([]);
  // Analysis per document. Loaded lazily alongside the documents so the
  // panel can say what it knows instead of implying nothing was found.
  const [analyses, setAnalyses] = useState<Record<string, { state: AnalysisState; analysis: DocumentAnalysis | null }>>({});
  const [notes, setNotes] = useState<{ id: string; body: string; created_at: string }[]>([]);
  const [noteDraft, setNoteDraft] = useState('');

  const [summary, setSummary] = useState<SynthesisView | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const [messages, setMessages] = useState<AskMessage[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [askBusy, setAskBusy] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!id) return;
    const r = await getDealRoom(id);
    setRoom(r);
    if (!r) return;
    const [a, q, d, f, n, ai] = await Promise.all([
      listActionItems(id), listQuestions(id), listDocuments(id), listFindings(id), listNotes(id),
      loadLatestAiThread(id),
    ]);
    setActions(a);
    setQuestions(q);
    setDocuments(d);
    setFindings(f);
    // A document analysed days ago must not read as "we have not read this
    // yet" when the customer comes back to it.
    const withFiles = d.filter((doc) => doc.storage_path);
    if (withFiles.length) {
      const loaded = await Promise.all(
        withFiles.map(async (doc) => {
          try {
            const a = await getDocumentAnalysis(doc.id);
            return [doc.id, { state: a.state, analysis: a.analysis }] as const;
          } catch {
            return [doc.id, { state: 'NONE' as AnalysisState, analysis: null }] as const;
          }
        })
      );
      setAnalyses(Object.fromEntries(loaded));
    }
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

  // The synthesis is fetched once the room is known. It is a separate call
  // because it may involve a model round-trip, and the rest of the room must
  // not wait on it.
  useEffect(() => {
    if (!room?.verify_job_id) return;
    let alive = true;
    setSummaryLoading(true);
    supabase.functions
      .invoke('verify-synthesis', { body: { jobId: room.verify_job_id } })
      .then(({ data, error }) => {
        if (!alive) return;
        if (error || !data || data.error) return;
        setSummary(data as SynthesisView);
      })
      .catch(() => undefined)
      .finally(() => alive && setSummaryLoading(false));
    return () => {
      alive = false;
    };
  }, [room?.verify_job_id]);

  /** Ask for this document to be read, then re-read the stored result.
   * The database state is the authority: on any failure we re-read rather
   * than guessing, so the panel never claims an analysis that does not exist. */
  const onAnalyzeDoc = async (doc: { id: string }) => {
    setAnalyses((prev) => ({ ...prev, [doc.id]: { state: 'RUNNING', analysis: null } }));
    try {
      await analyzeDocument(doc.id);
    } catch {
      /* fall through to the re-read below */
    }
    try {
      const a = await getDocumentAnalysis(doc.id);
      setAnalyses((prev) => ({ ...prev, [doc.id]: { state: a.state, analysis: a.analysis } }));
      if (id) setFindings(await listFindings(id));
    } catch {
      setAnalyses((prev) => ({ ...prev, [doc.id]: { state: 'FAILED', analysis: null } }));
    }
  };

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

  const onUpload = async (file: File) => {
    if (!id) return;
    setBusy(true);
    try {
      await uploadDocument({ roomId: id, file });
      toast.success(t('dr_docs_uploaded'));
      await reload();
    } catch {
      toast.error(t('dr_error_generic'));
    } finally {
      setBusy(false);
    }
  };

  const onDeleteDoc = async (doc: DocumentRecord) => {
    setBusy(true);
    try {
      await deleteDocument(doc.id, doc.storage_path);
      await reload();
    } catch {
      toast.error(t('dr_error_generic'));
    } finally {
      setBusy(false);
    }
  };

  const onAsk = async (question: string) => {
    if (!id) return;
    const localId = `local-${Date.now()}`;
    setMessages((m) => [...m, { id: localId, role: 'user', content: question, grounded: [] }]);
    setAskBusy(true);
    setAskError(null);
    try {
      const { data, error } = await supabase.functions.invoke('deal-room-ai', {
        body: { dealRoomId: id, question, threadId },
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
            <SynthesisSummary view={summary} loading={summaryLoading} subtitle={room.address} />
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
            <DocumentsPanel
              documents={documents}
              findings={findings}
              analyses={analyses}
              onUpload={onUpload}
              onDelete={onDeleteDoc}
              onAnalyze={onAnalyzeDoc}
              busy={busy}
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
    </AppLayout>
  );
};

export default VerificationCasePage;
