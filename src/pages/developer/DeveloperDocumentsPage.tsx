import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  FileText, Upload, Search, ExternalLink, ShieldAlert, Banknote, CheckCircle2,
  ScanLine,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDebounce } from '@/hooks/use-debounce';
import { DeveloperShell } from '@/components/developer/DeveloperShell';
import {
  Panel, PanelHeader, EmptyState, LoadingRows, ErrorState, TableScroll, Th, Td,
  Money, formatDate, formatDateTime, Eyebrow, GoldRule,
} from '@/components/developer/primitives';
import { useDeveloperWorkspace } from '@/contexts/DeveloperWorkspaceContext';
import { ExtractionReview } from '@/components/developer/ExtractionReview';
import {
  listDocuments, uploadDocument, signedDocumentUrl, confirmExtractionAsPayment,
  requestExtraction,
  suggestMatches, updateDocument, MAX_DOCUMENT_BYTES, type DocumentMatch,
} from '@/services/developer/documents';
import { listLedger, listSchedule } from '@/services/developer/sales';
import { devErrorText } from '@/services/developer/client';
import type {
  DevDocument, DocumentType, SalesLedgerRow, DevScheduleRow,
} from '@/services/developer/types';

/**
 * THE DOCUMENT CENTRE, AND THE REVIEW QUEUE (§37, §38, §39, §123).
 *
 * The rule that shapes this entire screen: NO EVIDENCE, NO FACT. A receipt
 * that has been read produces an EXTRACTION — a reading, with a confidence
 * and the fields it thinks it saw — and that extraction sits on the document
 * changing nothing at all. A payment appears when a person looks at the
 * reading, corrects whatever is wrong, chooses which deal it belongs to and
 * presses Confirm. What gets stored is what they confirmed, not what was
 * read; the original reading stays on the document so the two can be compared
 * later.
 *
 * Match suggestions say WHY they match — unit number, contract reference,
 * an amount equal to an outstanding instalment — because a person has to be
 * able to disagree with the reason rather than only with the answer. A match
 * on one signal is offered as "possible" and is never preselected.
 *
 * WHERE THE READING COMES FROM. Homatch already has document intelligence
 * (Contract Intelligence, and the deal-room document analyser). This screen
 * does not implement a second one: it stores the extraction shape, shows it,
 * and hands confirmation to a person. Until a workspace has extraction
 * switched on, documents simply arrive as UPLOADED and a person fills the
 * payment in themselves — which is exactly the same review step, without the
 * head start.
 */

const DOC_TYPES: DocumentType[] = [
  'CONTRACT', 'RESERVATION_AGREEMENT', 'INVOICE', 'PAYMENT_RECEIPT',
  'BANK_CONFIRMATION', 'PAYMENT_SCHEDULE', 'IDENTITY_DOCUMENT',
  'BROCHURE', 'FLOOR_PLAN', 'PROJECT_DOCUMENT', 'LEGAL_DOCUMENT', 'OTHER',
];

/**
 * Documents that carry fields worth reading. Everything else — a brochure,
 * a floor plan, an identity document — is stored and never sent to a model,
 * which is most of why this feature is cheap to run.
 */
const EXTRACTABLE: DocumentType[] = [
  'CONTRACT', 'RESERVATION_AGREEMENT', 'INVOICE',
  'PAYMENT_RECEIPT', 'BANK_CONFIRMATION', 'PAYMENT_SCHEDULE',
];

/** Documents whose fields amend the DEAL rather than record a payment. */
const CONTRACT_LIKE: DocumentType[] = ['CONTRACT', 'RESERVATION_AGREEMENT'];

/** Types that may legitimately be made visible outside the company. */
const PUBLISHABLE: DocumentType[] = ['BROCHURE', 'FLOOR_PLAN', 'PROJECT_DOCUMENT'];

export default function DeveloperDocumentsPage() {
  const { t, lang: language } = useLanguage();
  const [params, setParams] = useSearchParams();
  const { workspace, can } = useDeveloperWorkspace();

  const [documents, setDocuments] = useState<DevDocument[]>([]);
  const [deals, setDeals] = useState<SalesLedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [uploading, setUploading] = useState(false);
  const [reviewing, setReviewing] = useState<DevDocument | null>(null);
  const [extracting, setExtracting] = useState<string | null>(null);
  const reviewOnly = params.get('review') === '1';

  const debouncedSearch = useDebounce(search, 250);

  const load = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    try {
      const [docs, ledger] = await Promise.all([
        listDocuments(workspace.id, {
          search: debouncedSearch || undefined,
          docType: typeFilter === 'ALL' ? undefined : [typeFilter as DocumentType],
        }),
        listLedger(workspace.id),
      ]);
      setDocuments(docs);
      setDeals(ledger);
    } catch (e) {
      setError(e instanceof Error ? e.message : null);
    } finally {
      setLoading(false);
    }
  }, [workspace, debouncedSearch, typeFilter]);

  useEffect(() => { void load(); }, [load]);

  const queue = useMemo(
    () => documents.filter((d) => d.status === 'EXTRACTED' || d.status === 'ANALYZING'),
    [documents],
  );
  const listed = reviewOnly ? queue : documents;

  const open = async (doc: DevDocument) => {
    try {
      const url = await signedDocumentUrl(doc.storage_path, 60);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast.error(devErrorText(e, t));
    }
  };

  /**
   * Every outcome here is reported in the words that fit it. A scan is a
   * scan, an empty reading is an empty reading, and a wallet that will not
   * cover it says so — none of these is 'something went wrong'.
   */
  async function readDocument(doc: DevDocument) {
    setExtracting(doc.id);
    try {
      const outcome = await requestExtraction(doc.id);
      switch (outcome.state) {
        case 'EXTRACTED':
          toast.success(
            t('dev_doc_read_ok').replace('{n}', String(outcome.fields ?? 0)),
          );
          break;
        case 'NOTHING_FOUND':
          toast.error(t('dev_doc_read_nothing'));
          break;
        case 'REQUIRES_OCR':
          toast.error(t('dev_doc_read_scan'));
          break;
        case 'NOT_EXTRACTABLE':
          toast.error(t('dev_doc_read_not_extractable'));
          break;
        case 'BILLING_REQUIRED':
          toast.error(t('dev_doc_read_billing'));
          break;
        default:
          toast.error(t('dev_doc_read_failed'));
      }
      await load();
    } catch (e) {
      toast.error(devErrorText(e, t));
    } finally {
      setExtracting(null);
    }
  }

  return (
    <DeveloperShell
      title={t('dev_nav_documents')}
      description={t('dev_documents_subtitle')}
      requires="documents"
      actions={can('documents') ? (
        <Button onClick={() => setUploading(true)}>
          <Upload className="mr-2 h-4 w-4" />
          {t('dev_action_upload_document')}
        </Button>
      ) : undefined}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={t('dev_search_documents')} aria-label={t('dev_search_documents')}
            className="pl-8" />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-auto min-w-[10rem]" aria-label={t('dev_doc_type')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t('dev_filter_all')}</SelectItem>
            {DOC_TYPES.map((type) => (
              <SelectItem key={type} value={type}>{t(`dev_doc_${type.toLowerCase()}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant={reviewOnly ? 'default' : 'outline'}
          onClick={() => {
            if (reviewOnly) params.delete('review'); else params.set('review', '1');
            setParams(params, { replace: true });
          }}
          aria-pressed={reviewOnly}
        >
          {t('dev_doc_needs_review')}
          {queue.length > 0 && <span className="ml-1.5 tabular">({queue.length})</span>}
        </Button>
      </div>

      {loading && <LoadingRows rows={6} />}
      {!loading && error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && queue.length > 0 && !reviewOnly && (
        <Panel className="mb-5 border-amber-600/40">
          <PanelHeader
            title={t('dev_doc_queue_title')}
            description={t('dev_doc_queue_body')}
          />
          <ul className="divide-y divide-border">
            {queue.slice(0, 5).map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                <FileText className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-sm">{doc.title}</span>
                <Button size="sm" onClick={() => setReviewing(doc)}>{t('dev_doc_review')}</Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {!loading && !error && listed.length === 0 && (
        <Panel>
          <EmptyState
            icon={<FileText className="h-7 w-7" />}
            title={reviewOnly ? t('dev_doc_queue_empty') : t('dev_documents_empty_title')}
            description={reviewOnly ? undefined : t('dev_documents_empty_body')}
            action={can('documents') && !reviewOnly ? (
              <Button onClick={() => setUploading(true)}>
                <Upload className="mr-2 h-4 w-4" />{t('dev_action_upload_document')}
              </Button>
            ) : undefined}
          />
        </Panel>
      )}

      {!loading && !error && listed.length > 0 && (
        <Panel>
          <TableScroll>
            <table className="w-full text-sm" data-tabular>
              <thead className="border-b border-border bg-muted/40">
                <tr>
                  <Th>{t('dev_doc_title')}</Th>
                  <Th>{t('dev_doc_type')}</Th>
                  <Th>{t('dev_doc_linked')}</Th>
                  <Th>{t('dev_doc_visibility')}</Th>
                  <Th>{t('dev_status')}</Th>
                  <Th>{t('dev_doc_uploaded')}</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {listed.map((doc) => {
                  const deal = deals.find((d) => d.deal_id === doc.deal_id);
                  return (
                    <tr key={doc.id} className="transition-colors hover:bg-muted/40">
                      <Td className="max-w-[16rem] truncate font-medium" title={doc.title}>
                        {doc.title}
                      </Td>
                      <Td className="text-muted-foreground">{t(`dev_doc_${doc.doc_type.toLowerCase()}`)}</Td>
                      <Td className="text-muted-foreground">{deal?.unit_number ?? '—'}</Td>
                      <Td>
                        <span className={cn(
                          'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs',
                          doc.visibility === 'PRIVATE'
                            ? 'border-border text-muted-foreground'
                            : 'border-gold-border text-gold-ink',
                        )}>
                          {doc.visibility === 'PRIVATE' && <ShieldAlert className="h-3 w-3" aria-hidden="true" />}
                          {t(`dev_doc_vis_${doc.visibility.toLowerCase()}`)}
                        </span>
                      </Td>
                      <Td>
                        <span className="text-2xs text-muted-foreground">
                          {t(`dev_doc_status_${doc.status.toLowerCase()}`)}
                        </span>
                      </Td>
                      <Td className="text-muted-foreground">{formatDate(doc.created_at, language)}</Td>
                      <Td>
                        <div className="flex justify-end gap-1.5">
                          {/* Ask for the document to be read. Offered only
                              where there is something to read — a brochure
                              has no contract number — and only before it
                              has been read, so nobody pays twice for the
                              same page by clicking again. */}
                          {EXTRACTABLE.includes(doc.doc_type)
                            && doc.status === 'UPLOADED'
                            && can('documents') && (
                            <Button
                              size="sm" variant="ghost"
                              disabled={extracting === doc.id}
                              onClick={() => void readDocument(doc)}
                            >
                              <ScanLine className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                              {extracting === doc.id ? t('dev_doc_reading') : t('dev_doc_read')}
                            </Button>
                          )}
                          {CONTRACT_LIKE.includes(doc.doc_type)
                            && doc.status === 'EXTRACTED'
                            && can('documents') && (
                            <Button size="sm" variant="outline" onClick={() => setReviewing(doc)}>
                              <ScanLine className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                              {t('dev_doc_review_fields')}
                            </Button>
                          )}
                          {(doc.status === 'EXTRACTED' || doc.status === 'UPLOADED')
                            && ['PAYMENT_RECEIPT', 'BANK_CONFIRMATION', 'INVOICE'].includes(doc.doc_type)
                            && can('documents') && (
                            <Button size="sm" variant="outline" onClick={() => setReviewing(doc)}>
                              <Banknote className="mr-1.5 h-3.5 w-3.5" />
                              {t('dev_doc_to_payment')}
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => open(doc)}
                            aria-label={t('dev_open')}>
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </Panel>
      )}

      <UploadDialog
        open={uploading}
        deals={deals}
        onClose={() => setUploading(false)}
        onDone={() => { setUploading(false); void load(); }}
      />

      {reviewing && (
        <ReviewDialog
          document={reviewing}
          deals={deals}
          onClose={() => setReviewing(null)}
          onDone={() => { setReviewing(null); void load(); }}
        />
      )}
    </DeveloperShell>
  );
}

function UploadDialog({
  open, deals, onClose, onDone,
}: { open: boolean; deals: SalesLedgerRow[]; onClose: () => void; onDone: () => void }) {
  const { t } = useLanguage();
  const { workspace } = useDeveloperWorkspace();
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<DocumentType>('PAYMENT_RECEIPT');
  const [dealId, setDealId] = useState('NONE');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setFile(null); setDocType('PAYMENT_RECEIPT'); setDealId('NONE'); }
  }, [open]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!workspace || !file || saving) return;
    setSaving(true);
    try {
      const deal = deals.find((d) => d.deal_id === dealId);
      await uploadDocument(workspace.id, {
        file,
        docType,
        dealId: dealId === 'NONE' ? null : dealId,
        unitId: deal?.unit_id ?? null,
        leadId: deal?.lead_id ?? null,
        projectId: deal?.project_id ?? null,
        // A contract is never offered as public; only marketing material is.
        visibility: 'PRIVATE',
      });
      toast.success(t('dev_doc_uploaded'));
      onDone();
    } catch (error) {
      toast.error(devErrorText(error, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('dev_action_upload_document')}</DialogTitle>
          <DialogDescription>{t('dev_doc_upload_hint')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center transition-colors hover:border-gold-border/70 focus-within:ring-2 focus-within:ring-ring">
            <Upload className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            <span className="text-sm font-medium">
              {file ? file.name : t('dev_doc_choose_file')}
            </span>
            <span className="text-2xs text-muted-foreground">
              {t('dev_doc_max_size').replace('{mb}', String(Math.round(MAX_DOCUMENT_BYTES / 1048576)))}
            </span>
            <input
              type="file" className="sr-only"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>

          <div className="space-y-1.5">
            <Label htmlFor="dev-doc-type">{t('dev_doc_type')}</Label>
            <Select value={docType} onValueChange={(v) => setDocType(v as DocumentType)}>
              <SelectTrigger id="dev-doc-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>{t(`dev_doc_${type.toLowerCase()}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {deals.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="dev-doc-deal">{t('dev_doc_link_deal')}</Label>
              <Select value={dealId} onValueChange={setDealId}>
                <SelectTrigger id="dev-doc-deal"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">{t('dev_doc_no_deal')}</SelectItem>
                  {deals.map((d) => (
                    <SelectItem key={d.deal_id} value={d.deal_id}>
                      {d.unit_number} — {d.buyer ?? t('dev_unnamed_buyer')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <p className="text-2xs text-muted-foreground">{t('dev_doc_private_note')}</p>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>{t('dev_cancel')}</Button>
            <Button type="submit" disabled={!file || saving}>
              {saving ? t('dev_uploading') : t('dev_upload')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The confirm step. Nothing on this dialog is written anywhere until the
 * button at the bottom is pressed, and what is written is the contents of
 * these fields — which the person may have corrected — not the extraction.
 */
function ReviewDialog({
  document: doc, deals, onClose, onDone,
}: {
  document: DevDocument;
  deals: SalesLedgerRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, lang: language } = useLanguage();
  const { workspace } = useDeveloperWorkspace();
  const extraction = doc.extraction;

  const [dealId, setDealId] = useState(doc.deal_id ?? '');
  const [schedule, setSchedule] = useState<DevScheduleRow[]>([]);
  const [scheduleId, setScheduleId] = useState('NONE');
  const [amount, setAmount] = useState(
    extraction?.suggested_amount != null ? String(extraction.suggested_amount) : '');
  const [paidAt, setPaidAt] = useState(
    extraction?.suggested_paid_at ?? new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState(extraction?.suggested_reference ?? '');
  const [saving, setSaving] = useState(false);

  /* The ledger row this document belongs to, which already carries the
     four fields a contract review compares against. */
  const contractTarget = useMemo(() => {
    const row = deals.find((d) => d.deal_id === (doc.deal_id ?? dealId));
    if (!row) return null;
    return {
      contract_number: row.contract_number,
      contract_date: row.contract_date,
      sale_price: row.sale_price,
      currency: row.currency,
    };
  }, [deals, doc.deal_id, dealId]);

  const matches: DocumentMatch[] = useMemo(() => {
    if (!extraction) return [];
    return suggestMatches(extraction, deals.map((d) => ({
      dealId: d.deal_id,
      unitNumber: d.unit_number,
      buyer: d.buyer,
      contractNumber: d.contract_number,
      currency: d.currency,
      schedule: [],
    })));
  }, [extraction, deals]);

  useEffect(() => {
    if (!dealId) { setSchedule([]); return; }
    listSchedule(dealId)
      .then((rows) => {
        setSchedule(rows);
        const value = Number(amount);
        const exact = Number.isFinite(value)
          ? rows.find((s) => s.status !== 'PAID'
              && Math.abs((Number(s.amount) - Number(s.paid_amount)) - value) < 0.01)
          : undefined;
        setScheduleId(exact?.id ?? 'NONE');
      })
      .catch(() => {
        // Without a plan there are no instalments to attach to; the payment is
        // still recordable against the deal.
        setSchedule([]);
      });
  }, [dealId, amount]);

  const deal = deals.find((d) => d.deal_id === dealId);
  const value = Number(amount);
  const valid = Boolean(dealId) && Number.isFinite(value) && value > 0 && Boolean(paidAt);

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('dev_doc_review')}</DialogTitle>
          <DialogDescription>{t('dev_doc_review_hint')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <p className="truncate rounded-md bg-muted px-3 py-2 text-xs" title={doc.title}>
            {doc.title}
          </p>

          {/*
           * A CONTRACT AND A RECEIPT ARE REVIEWED DIFFERENTLY.
           *
           * A receipt becomes a payment, which needs a deal, an amount and
           * an instalment to sit against — the flow below. A contract
           * amends the deal itself, field by field, and every one of those
           * fields already has a value somebody may have typed. So it gets
           * the tick-what-you-accept gate, where the server refuses to
           * overwrite a disagreement unless it is told to.
           */}
          {CONTRACT_LIKE.includes(doc.doc_type) ? (
            <ExtractionReview
              doc={doc}
              deal={contractTarget}
              onApplied={async () => { onDone(); }}
            />
          ) : extraction ? (
            <section className="space-y-2">
              <div>
                <Eyebrow>{t('dev_doc_what_we_read')}</Eyebrow>
                <GoldRule className="mt-2" />
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-border p-3 text-xs">
                {Object.entries(extraction.fields ?? {}).map(([key, field]) => (
                  <div key={key} className="min-w-0">
                    <dt className="truncate text-2xs uppercase tracking-wider text-muted-foreground">{key}</dt>
                    <dd className="truncate">
                      {String(field.value ?? '—')}
                      {field.confidence != null && (
                        <span className="ml-1 text-muted-foreground">
                          ({Math.round(field.confidence * 100)}%)
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="text-2xs text-muted-foreground">{t('dev_doc_reading_note')}</p>
            </section>
          ) : (
            <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
              {t('dev_doc_no_extraction')}
            </p>
          )}

          {matches.length > 0 && (
            <section className="space-y-2">
              <div>
                <Eyebrow>{t('dev_doc_suggested_match')}</Eyebrow>
                <GoldRule className="mt-2" />
              </div>
              <ul className="space-y-1.5">
                {matches.map((match) => (
                  <li key={match.dealId}>
                    <button
                      type="button"
                      onClick={() => setDealId(match.dealId)}
                      className={cn(
                        'w-full rounded-md border px-3 py-2 text-left text-xs transition-colors',
                        dealId === match.dealId
                          ? 'border-gold-border bg-gold/[0.07]'
                          : 'border-border hover:border-gold-border/60',
                      )}
                    >
                      <span className="font-medium">{match.label}</span>
                      <span className="ml-2 text-muted-foreground">
                        {t(match.strength === 'STRONG' ? 'dev_match_strong' : 'dev_match_possible')}
                        {' · '}
                        {match.reasons.map((r) => t(`dev_match_reason_${r}`)).join(', ')}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="text-2xs text-muted-foreground">{t('dev_doc_match_note')}</p>
            </section>
          )}

          <section className="space-y-3">
            <div>
              <Eyebrow>{t('dev_doc_confirm_section')}</Eyebrow>
              <GoldRule className="mt-2" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dev-rv-deal">{t('dev_deal')}</Label>
              <Select value={dealId} onValueChange={setDealId}>
                <SelectTrigger id="dev-rv-deal">
                  <SelectValue placeholder={t('dev_doc_pick_deal')} />
                </SelectTrigger>
                <SelectContent>
                  {deals.map((d) => (
                    <SelectItem key={d.deal_id} value={d.deal_id}>
                      {d.unit_number} — {d.buyer ?? t('dev_unnamed_buyer')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {schedule.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="dev-rv-sched">{t('dev_instalment')}</Label>
                <Select value={scheduleId} onValueChange={setScheduleId}>
                  <SelectTrigger id="dev-rv-sched"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">{t('dev_no_instalment')}</SelectItem>
                    {schedule.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.label} · {formatDate(s.due_date, language)} ·{' '}
                        {Number(s.amount) - Number(s.paid_amount)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="dev-rv-amount">{t('dev_amount')}</Label>
                <Input id="dev-rv-amount" inputMode="decimal" value={amount}
                  onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dev-rv-date">{t('dev_paid_on')}</Label>
                <Input id="dev-rv-date" type="date" value={paidAt}
                  onChange={(e) => setPaidAt(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dev-rv-ref">{t('dev_reference')}</Label>
              <Input id="dev-rv-ref" value={reference}
                onChange={(e) => setReference(e.target.value)} maxLength={120} />
            </div>

            {deal && (
              <p className="text-2xs text-muted-foreground">
                {t('dev_doc_outstanding_now')}{' '}
                <Money amount={deal.outstanding} currency={deal.currency} />
              </p>
            )}
          </section>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await updateDocument(doc.id, { status: 'REJECTED' });
                toast.success(t('dev_doc_rejected'));
                onDone();
              } catch (error) {
                toast.error(devErrorText(error, t));
              }
            }}
          >
            {t('dev_doc_not_a_payment')}
          </Button>
          <Button
            disabled={!valid || saving}
            onClick={async () => {
              if (!workspace || !deal) return;
              setSaving(true);
              try {
                await confirmExtractionAsPayment(workspace.id, doc, {
                  dealId,
                  scheduleId: scheduleId === 'NONE' ? null : scheduleId,
                  amount: value,
                  currency: deal.currency,
                  paidAt,
                  method: 'BANK_TRANSFER',
                  reference: reference.trim() || null,
                });
                toast.success(t('dev_doc_confirmed_as_payment'));
                onDone();
              } catch (error) {
                toast.error(devErrorText(error, t));
              } finally {
                setSaving(false);
              }
            }}
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            {saving ? t('dev_saving') : t('dev_doc_confirm_payment')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
