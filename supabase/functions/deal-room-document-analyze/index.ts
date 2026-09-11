// HOMATCH — contract analysis for an uploaded Deal Room document.
//
// WHAT THIS DOES
//
// A buyer uploads a contract they cannot read and asks what they are agreeing
// to. This reads the file, explains it in plain language, and — as one
// additional layer — cross-checks the facts it states against what Verify
// found in the public registry.
//
// The pipeline, in order, and every step is refusable:
//
//   authenticated caller
//   -> the document row, through the CALLER's RLS (so ownership is not a
//      check this function performs, it is a check it cannot avoid)
//   -> the private object, through the same RLS
//   -> magic-byte + size + type validation (never the filename, never the
//      client-declared MIME)
//   -> text extraction
//   -> is there actually text? a scan is reported as a scan, never analysed
//   -> bounded prompt, document supplied as untrusted DATA
//   -> strict validation: every claim re-grounded in the document text
//   -> registry cross-check
//   -> persisted, replacing any previous analysis of the same file
//
// WHY THE CALLER'S JWT AND NOT SERVICE ROLE
//
// Deliberate, and the same choice deal-room-ai makes. Every read and write
// below goes through the caller's own policies, so a forged document id or
// deal room id simply returns nothing. There is no service-role path in this
// function, which means there is no code path in which a bug could read
// another customer's contract.
//
// WHAT IS NEVER DONE
//
// No document text is logged. No signed URL is returned. No legal conclusion
// is produced — validation rejects them (see documentExtract.ts). Nothing is
// invented for a document we could not read.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { extractText, getDocumentProxy } from 'npm:unpdf@0.12.1';
import JSZip from 'npm:jszip@3.10.1';
import { documentKind, extractDocxText, DOCX_MIME } from '../../../src/dealroom/domain/docx.ts';
import { projectVerify } from '../../../src/dealroom/domain/assemble.ts';
import { crossCheck, toFindingRows } from '../../../src/dealroom/domain/contractCheck.ts';
import {
  buildAnalysisPrompt,
  parseAnalysis,
  hasMeaningfulText,
  normalizeDocumentText,
  looksLikePromptInjection,
} from '../../../src/dealroom/domain/documentExtract.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const MODEL = Deno.env.get('OPENAI_MODEL') || 'gpt-5.6-luna';

/** Matches the bucket's own limit. Checked here too because the bucket limit
 * is enforced at upload and this function can be asked to re-read a row whose
 * object was replaced. */
const MAX_BYTES = 20 * 1024 * 1024;

const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

function textOf(p: any): string {
  if (p?.output_text) return p.output_text;
  const a: string[] = [];
  for (const i of p?.output || []) {
    if (i?.type === 'message') for (const c of i.content || []) if (c?.type === 'output_text' && c.text) a.push(c.text);
  }
  return a.join('\n').trim();
}

/** SHA-256 of the bytes actually read, so the stored analysis is tied to the
 * file it was produced from rather than to a row that may have been edited. */
async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Trust the bytes, never the filename or the declared MIME. */

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  let supabase: any = null;
  let documentId = '';

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ error: 'unauthorized' }, 401);

    supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id;
    if (!userId) return json({ error: 'unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    documentId = String(body?.documentId ?? '').trim();
    const force = body?.force === true;
    const language = typeof body?.language === 'string' ? body.language.slice(0, 12) : undefined;
    if (!documentId) return json({ error: 'documentId is required' }, 400);

    /* ---- the document, via RLS ---- */
    const { data: doc, error: docErr } = await supabase
      .from('deal_room_documents')
      .select('id,deal_room_id,storage_path,mime_type,size_bytes,analysis_state,analysis_sha256,label')
      .eq('id', documentId)
      .maybeSingle();
    if (docErr) throw docErr;
    if (!doc) return json({ error: 'document not found' }, 404);
    if (!doc.storage_path) return json({ error: 'document has no file' }, 400);

    /* ---- PDF and DOCX, by declared type as a first filter ----
     *
     * This gate used to be application/pdf only, while uploadValidation's
     * ALLOWED_MIME and the storage bucket both accepted Word documents. So a
     * customer could upload a contract as .docx, watch it upload cleanly, and
     * be told immediately that it could not be analysed — two layers of the
     * same feature disagreeing about what the product supports. That is the
     * reported upload failure.
     *
     * The legacy binary .doc is deliberately still refused: it is a different
     * format entirely, not a ZIP, and nothing here can read it. */
    const ANALYSABLE_MIME = ['application/pdf', DOCX_MIME];
    if (doc.mime_type && !ANALYSABLE_MIME.includes(doc.mime_type)) {
      await supabase
        .from('deal_room_documents')
        .update({
          analysis_state: 'UNSUPPORTED',
          analysis_error: 'only PDF and Word (.docx) documents can be analysed',
          analyzed_at: new Date().toISOString(),
        })
        .eq('id', documentId);
      return json({ state: 'UNSUPPORTED', reason: 'UNSUPPORTED_TYPE' });
    }

    await supabase.from('deal_room_documents').update({ analysis_state: 'RUNNING' }).eq('id', documentId);

    /* ---- the private object, via the same RLS ---- */
    const dl = await supabase.storage.from('deal-room-documents').download(doc.storage_path);
    if (dl.error || !dl.data) {
      await supabase
        .from('deal_room_documents')
        .update({ analysis_state: 'FAILED', analysis_error: 'file could not be read', analyzed_at: new Date().toISOString() })
        .eq('id', documentId);
      return json({ state: 'FAILED', reason: 'DOWNLOAD_FAILED' }, 200);
    }

    const buf = await dl.data.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) {
      await supabase
        .from('deal_room_documents')
        .update({ analysis_state: 'UNSUPPORTED', analysis_error: 'file is empty or too large', analyzed_at: new Date().toISOString() })
        .eq('id', documentId);
      return json({ state: 'UNSUPPORTED', reason: 'SIZE' });
    }

    const bytes = new Uint8Array(buf);
    // Bytes decide, not the declared type: a browser reports whatever it likes
    // for a renamed file, and the declared type is the one thing an attacker
    // controls for free.
    const kind = documentKind(bytes, doc.mime_type);
    if (kind === 'UNSUPPORTED') {
      await supabase
        .from('deal_room_documents')
        .update({ analysis_state: 'UNSUPPORTED', analysis_error: 'file is not a readable PDF or Word document', analyzed_at: new Date().toISOString() })
        .eq('id', documentId);
      return json({ state: 'UNSUPPORTED', reason: 'UNSUPPORTED_TYPE' });
    }

    const sha = await sha256Hex(buf);

    /* ---- idempotency: same bytes, already analysed, nothing to redo ---- */
    if (!force && doc.analysis_state === 'DONE' && doc.analysis_sha256 === sha) {
      return json({ state: 'DONE', reason: 'ALREADY_ANALYSED', unchanged: true });
    }

    /* ---- text ---- */
    let raw = '';
    let pages = 0;
    try {
      if (kind === 'DOCX') {
        // A .docx is a ZIP; word/document.xml is the body. Everything after
        // the unzip is pure and lives in src/dealroom/domain/docx.ts.
        const zip = await JSZip.loadAsync(bytes);
        const entry = zip.file('word/document.xml');
        if (!entry) throw new Error('no word/document.xml');
        raw = extractDocxText(await entry.async('string'));
        // A Word file has no page count until it is laid out, and guessing one
        // would be inventing a fact about the document.
        pages = 0;
      } else {
        const pdf = await getDocumentProxy(bytes);
        pages = pdf.numPages ?? 0;
        const res = await extractText(pdf, { mergePages: true });
        raw = typeof res?.text === 'string' ? res.text : Array.isArray(res?.text) ? res.text.join('\n') : '';
      }
    } catch {
      await supabase
        .from('deal_room_documents')
        .update({ analysis_state: 'FAILED', analysis_error: 'the document could not be parsed', analyzed_at: new Date().toISOString() })
        .eq('id', documentId);
      return json({ state: 'FAILED', reason: 'PARSE_FAILED' });
    }

    const text = normalizeDocumentText(raw);

    // A scan is a scan. Saying anything else about a document nobody could
    // read is exactly the failure mode this product exists to avoid.
    if (!hasMeaningfulText(text)) {
      await supabase
        .from('deal_room_documents')
        .update({
          analysis_state: 'REQUIRES_OCR',
          analysis_error: null,
          analysis: null,
          analysis_sha256: sha,
          analyzed_at: new Date().toISOString(),
        })
        .eq('id', documentId);
      return json({ state: 'REQUIRES_OCR', pages });
    }

    /* ---- what Verify already knows, for the cross-check layer ---- */
    let facts: any[] = [];
    let interestingFactTypes: string[] = [];
    const { data: room } = await supabase
      .from('deal_rooms')
      .select('id,verify_job_id')
      .eq('id', doc.deal_room_id)
      .maybeSingle();
    if (room?.verify_job_id) {
      const { data: job } = await supabase
        .from('research_jobs')
        .select('id,result_json')
        .eq('id', room.verify_job_id)
        .maybeSingle();
      if (job) {
        const projection = projectVerify({ jobId: job.id, report: job.result_json });
        facts = projection.facts ?? [];
        interestingFactTypes = [...new Set(facts.map((f: any) => f.type))].slice(0, 20);
      }
    }

    /* ---- the model ---- */
    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) {
      await supabase
        .from('deal_room_documents')
        .update({ analysis_state: 'FAILED', analysis_error: 'analysis is unavailable', analyzed_at: new Date().toISOString() })
        .eq('id', documentId);
      return json({ state: 'FAILED', reason: 'ANALYSIS_UNAVAILABLE' }, 503);
    }

    const { system, user } = buildAnalysisPrompt(text, { interestingFactTypes, language });
    let modelText = '';
    try {
      const res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          input: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
      if (res.ok) modelText = textOf(await res.json());
    } catch {
      // fall through: an empty model response degrades to an empty analysis
      // rather than to invented content.
    }

    const analysis = parseAnalysis(modelText, text);

    /* ---- registry cross-check, as one layer on top ---- */
    const checked = crossCheck(analysis.findings, facts as any);

    /* ---- persist, replacing any earlier analysis of this document ---- */
    await supabase.from('deal_room_document_findings').delete().eq('document_id', documentId);

    if (checked.length) {
      const rows = toFindingRows(checked, {
        documentId,
        dealRoomId: doc.deal_room_id,
        userId,
      });
      const { error: insErr } = await supabase.from('deal_room_document_findings').insert(rows);
      if (insErr) throw insErr;
    }

    const stored = {
      documentType: analysis.documentType,
      summary: analysis.summary,
      clauses: analysis.clauses,
      obligations: analysis.obligations,
      deadlines: analysis.deadlines,
      financial: analysis.financial,
      missingProtections: analysis.missingProtections,
      questions: analysis.questions,
      pages,
      // A document that tried to instruct the model is worth surfacing to the
      // buyer as a fact about the document itself.
      containsInstructionLikeText: looksLikePromptInjection(text),
      analysedAt: new Date().toISOString(),
    };

    await supabase
      .from('deal_room_documents')
      .update({
        analysis_state: 'DONE',
        analysis_error: null,
        analysis: stored,
        analysis_sha256: sha,
        analyzed_at: new Date().toISOString(),
        state: 'ANALYZED',
      })
      .eq('id', documentId);

    return json({
      state: 'DONE',
      pages,
      documentType: analysis.documentType,
      summaryCount: analysis.summary.length,
      clauseCount: analysis.clauses.length,
      obligationCount: analysis.obligations.length,
      deadlineCount: analysis.deadlines.length,
      financialCount: analysis.financial.length,
      missingProtectionCount: analysis.missingProtections.length,
      questionCount: analysis.questions.length,
      findingCount: checked.length,
      contradictions: checked.filter((c) => c.verifyRelation === 'CONTRADICTS').length,
      // How much the model proposed that could not be grounded.
      discarded: analysis.rejected.length,
      // WHY it was discarded. Returned only to the document's own owner —
      // they already have the document — because "we found nothing" with no
      // explanation is indistinguishable from a broken extractor, and that
      // ambiguity is exactly what hides a silent failure.
      discardedReasons: analysis.rejected.slice(0, 8),
      statusCounts: analysis.statusCounts,
      // Length only, never content: enough to tell "the PDF gave us nothing"
      // apart from "the model gave us nothing".
      extractedChars: text.length,
      containsInstructionLikeText: stored.containsInstructionLikeText,
    });
  } catch (e) {
    // Never log document text. The message is ours, not the document's.
    console.error('deal-room-document-analyze failed', e instanceof Error ? e.message : 'unknown');
    if (supabase && documentId) {
      await supabase
        .from('deal_room_documents')
        .update({ analysis_state: 'FAILED', analysis_error: 'analysis failed', analyzed_at: new Date().toISOString() })
        .eq('id', documentId)
        .then(() => {}, () => {});
    }
    return json({ error: 'internal_error' }, 500);
  }
});
