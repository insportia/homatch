// HOMATCH — Deal Room documents and contract findings.
//
// Contradictions lead. A contract that says 94.1 m² while the registry says
// 88.0 m² is the single most valuable thing this feature can surface, so it is
// shown first and marked, rather than being one row among many.
//
// The legal-position note is permanent and not dismissible: Homatch helps a
// buyer ask better questions, it does not replace a lawyer, and the UI should
// never let someone forget which of those they are reading.
import React, { useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { ContractAnalysisPanel } from './ContractAnalysisPanel';
import type { AnalysisState, DocumentAnalysis } from '@/services/dealRoomDocuments';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Upload, FileText, Trash2, AlertTriangle, CheckCircle2, Scale } from 'lucide-react';
import { ALLOWED_MIME, validateUpload } from '@/services/dealRoomDocuments';
import type { DocumentFinding } from '@/services/dealRoomDocuments';
import type { DocumentRecord } from '@/services/dealRooms';

const REJECTION_KEY: Record<string, string> = {
  TOO_LARGE: 'dr_docs_too_large',
  UNSUPPORTED_TYPE: 'dr_docs_bad_type',
  SUSPICIOUS_NAME: 'dr_docs_bad_name',
  EMPTY: 'dr_docs_bad_type',
};

export function DocumentsPanel({
  documents,
  findings,
  analyses,
  onUpload,
  onDelete,
  onAnalyze,
  busy,
}: {
  documents: DocumentRecord[];
  findings: DocumentFinding[];
  /** Analysis per document id. Absent means we have not read it yet, which
   * the panel says plainly rather than leaving the customer guessing. */
  analyses?: Record<string, { state: AnalysisState; analysis: DocumentAnalysis | null }>;
  onUpload: (file: File) => void;
  onDelete: (doc: DocumentRecord) => void;
  onAnalyze?: (doc: DocumentRecord) => void;
  busy?: boolean;
}) {
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);

  const pick = (file: File | undefined) => {
    if (!file) return;
    // Validated here so the customer gets an immediate, understandable reason
    // rather than a storage error from the network layer.
    const v = validateUpload({ name: file.name, size: file.size, type: file.type });
    if (!v.ok) {
      setRejection(REJECTION_KEY[v.reason] ?? 'dr_docs_bad_type');
      return;
    }
    setRejection(null);
    onUpload(file);
  };

  const uploaded = documents.filter((d) => d.storage_path);
  const contradictions = findings.filter((f) => f.verify_relation === 'CONTRADICTS');
  const agreements = findings.filter((f) => f.verify_relation === 'AGREES');

  return (
    <div className="space-y-4">
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
          <Button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="w-full sm:w-auto gap-2"
          >
            <Upload className="h-4 w-4" />
            {t('dr_docs_upload')}
          </Button>
          <p className="text-xs text-muted-foreground leading-relaxed">{t('dr_docs_hint')}</p>
          {rejection ? <p className="text-sm text-destructive">{t(rejection)}</p> : null}
        </CardContent>
      </Card>

      {contradictions.length > 0 && (
        <Card className="border-amber-300 dark:border-amber-800">
          <CardContent className="pt-5 space-y-3">
            <h3 className="text-base font-semibold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              {t('dr_docs_contradicts')}
            </h3>
            {contradictions.map((f) => (
              <FindingRow key={f.id} finding={f} />
            ))}
          </CardContent>
        </Card>
      )}

      {agreements.length > 0 && (
        <Card>
          <CardContent className="pt-5 space-y-3">
            <h3 className="text-base font-semibold flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              {t('dr_docs_agrees')}
            </h3>
            {agreements.map((f) => (
              <FindingRow key={f.id} finding={f} />
            ))}
          </CardContent>
        </Card>
      )}

      {uploaded.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t('dr_docs_empty')}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-5 space-y-3">
            {uploaded.map((d) => (
              <div key={d.id} className="space-y-3">
                <div className="flex items-start gap-3">
                  <FileText className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium break-words">{d.original_filename ?? d.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {d.size_bytes ? `${Math.round(d.size_bytes / 1024)} KB` : ''}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    aria-label={t('dr_docs_delete')}
                    onClick={() => onDelete(d)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                {/* What the contract actually says, under the file it came
                    from — so the explanation is never detached from its
                    source document. */}
                {onAnalyze ? (
                  <ContractAnalysisPanel
                    state={analyses?.[d.id]?.state ?? 'NONE'}
                    analysis={analyses?.[d.id]?.analysis ?? null}
                    busy={busy}
                    onAnalyze={() => onAnalyze(d)}
                  />
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground flex gap-2 leading-relaxed">
        <Scale className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
        <span className="min-w-0">{t('dr_docs_legal_note')}</span>
      </p>
    </div>
  );
}

function FindingRow({ finding }: { finding: DocumentFinding }) {
  return (
    <div className="text-sm space-y-1">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-medium break-words">{finding.label}</span>
        {finding.value ? <span className="break-words">{finding.value}</span> : null}
        {finding.severity === 'IMPORTANT' ? (
          <Badge variant="destructive" className="text-[11px]">!</Badge>
        ) : null}
      </div>
      {/* The quote is the provenance. A finding that cannot point at the text
          it came from is not shown as a contract fact at all. */}
      {finding.quote ? (
        <blockquote className="text-xs text-muted-foreground border-l-2 pl-3 break-words">
          {finding.quote}
          {finding.page ? ` (p. ${finding.page})` : ''}
        </blockquote>
      ) : null}
    </div>
  );
}
