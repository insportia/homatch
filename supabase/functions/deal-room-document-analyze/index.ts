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
import { getDocumentProxy } from 'npm:unpdf@0.12.1';
import { DocumentTooLarge, MAX_DOCX_XML_BYTES, assertDocxParsable, pdfTextForAnalysis } from '../_shared/boundedDocumentText.ts';
import JSZip from 'npm:jszip@3.10.1';
import { documentKind, extractDocxText, DOCX_MIME } from '../../../src/dealroom/domain/docx.ts';
import { projectVerify } from '../../../src/dealroom/domain/assemble.ts';
import { crossCheck, toFindingRows } from '../../../src/dealroom/domain/contractCheck.ts';
import { beginExecution, settleExecution, releaseExecution, serviceClient } from '../_shared/billing.ts';
import { beginEntitled, commitEntitled, releaseEntitled, type EntitledGrant } from '../_shared/entitlements.ts';
import { deferCost, recordUsageCost, tokenUsage } from '../_shared/providerCost.ts';

/* Give a started use back: the wallet hold (legacy credit holders) or the trial / plan slot. */
// deno-lint-ignore no-explicit-any
async function releaseGate(svc: any, g: EntitledGrant, reason: string): Promise<void> {
  if (g.funding === 'LEGACY_CREDITS' && g.legacy) await releaseExecution(svc, g.legacy, reason);
  else await releaseEntitled(svc, g, reason);
}
import { notify } from '../_shared/notify.ts';
import { retentionBlocked } from '../_shared/retentionGuard.ts';
import { readRouted } from '../_shared/storage/routed.ts';
import {
  buildAnalysisPrompt,
  parseAnalysis,
  hasMeaningfulText,
  normalizeDocumentText,
  documentTextWasTruncated,
  looksLikePromptInjection,
} from '../../../src/dealroom/domain/documentExtract.ts';
import { serviceBackendEnabled, serviceDisabledBody } from '../_shared/serviceControl.ts';

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

/**
 * The product's fixed price in credits, or null when it is not fixed-priced.
 * Read from billable_products (billing_mode FIXED, standard_retail_cents), so
 * an admin price change needs no redeploy. 10 credits = $1, so credits =
 * cents / 10. Any read failure answers null: the run then falls back to the
 * cost-based path rather than charging a guessed amount.
 */
async function fixedPriceCredits(svc: any, productCode: string): Promise<number | null> {
  try {
    const { data } = await svc.from('billable_products')
      .select('billing_mode, standard_retail_cents').eq('code', productCode).maybeSingle();
    if (data?.billing_mode !== 'FIXED') return null;
    const cents = Number(data.standard_retail_cents);
    if (!Number.isFinite(cents) || cents <= 0) return null;
    return Math.round(cents) / 10;
  } catch {
    return null;
  }
}

/** Trust the bytes, never the filename or the declared MIME. */

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  let supabase: any = null;
  let documentId = '';
  /* The hold this run placed, and whether it was settled or released. Any
   * exception after the hold gives the money back in the catch below instead
   * of leaving it reserved until the sweeper finds it. */
  let heldGrant: EntitledGrant | null = null;
  let billingClosed = false;
  let svcForRelease: any = null;

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ error: 'unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    documentId = String(body?.documentId ?? '').trim();
    const force = body?.force === true;
    const language = typeof body?.language === 'string' ? body.language.slice(0, 12) : undefined;
    if (!documentId) return json({ error: 'documentId is required' }, 400);

    /*
     * TWO WAYS IN, AND ONLY ONE OF THEM IS A PERSON.
     *
     * The customer's own session is the normal path and is unchanged: RLS
     * decides which document they may read, and one that is not theirs simply
     * is not found.
     *
     * jobs-worker is the second. It has no session — it is a cron tick —
     * because the entire point of a durable job is that the browser which
     * started the analysis is gone. Letting it in needs a capability rather
     * than trust, so it presents TWO things: the service key, which only
     * Homatch holds, and a background_jobs row whose subject_id is this exact
     * document. The job row IS the authorisation; the key alone will not do,
     * so a leaked key cannot be pointed at an arbitrary document id without a
     * matching job to go with it.
     */
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const workerJobId = String(body?.workerJobId ?? '').trim();
    const claimsWorker = !!workerJobId && !!serviceKey && authHeader === `Bearer ${serviceKey}`;

    let userId: string | undefined;

    if (claimsWorker) {
      supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
      const { data: job } = await supabase
        .from('background_jobs')
        .select('id,user_id,subject_id,subject_type,product_type,state')
        .eq('id', workerJobId)
        .maybeSingle();
      if (
        !job ||
        job.subject_type !== 'DOCUMENT' ||
        job.product_type !== 'DOCUMENT_ANALYSIS' ||
        job.subject_id !== documentId ||
        ['COMPLETED', 'FAILED', 'CANCELLED'].includes(String(job.state))
      ) {
        return json({ error: 'unauthorized' }, 401);
      }
      userId = job.user_id as string;
    } else {
      // SERVICE CONTROL (key `contracts`): the browser's own kick waits while paused; its
      // durable job stays queued for jobs-worker (which also waits) instead.
      if (serviceKey && !(await serviceBackendEnabled(createClient(Deno.env.get('SUPABASE_URL')!, serviceKey), 'contracts'))) {
        return json(serviceDisabledBody('contracts'), 503);
      }
      supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: auth } = await supabase.auth.getUser();
      userId = auth?.user?.id;
      if (!userId) return json({ error: 'unauthorized' }, 401);
    }

    /* ---- the document, via RLS ---- */
    const { data: doc, error: docErr } = await supabase
      .from('deal_room_documents')
      .select('id,deal_room_id,storage_path,mime_type,size_bytes,analysis_state,analysis_sha256,label')
      .eq('id', documentId)
      .maybeSingle();
    if (docErr) throw docErr;
    if (!doc) return json({ error: 'document not found' }, 404);
    // Retention (20261102090000): an expired document is never re-analysed —
    // the worker path reads with the service role, so it asks explicitly.
    try {
      if (await retentionBlocked(supabase, 'CONTRACT_DOCUMENT', documentId)) return json({ error: 'document_expired' }, 410);
    } catch {
      return json({ error: 'retention_check_unavailable' }, 503);
    }
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
    try {
      await supabase.from('deal_room_document_events').insert({
        document_id: documentId, deal_room_id: doc.deal_room_id, user_id: userId,
        event_type: 'ANALYSIS_STARTED', detail: { worker: claimsWorker },
      });
    } catch { /* history is bookkeeping, not the result */ }

    /* ---- the private object, via the same RLS ---- */
    // R2 first, then the caller's own RLS-bound download (_shared/storage/routed.ts);
    // the row above was read through that same client, so the path is theirs.
    const dl = await readRouted(supabase, 'deal-room-documents', doc.storage_path);
    if (!dl) {
      await supabase
        .from('deal_room_documents')
        .update({ analysis_state: 'FAILED', analysis_error: 'file could not be read', analyzed_at: new Date().toISOString() })
        .eq('id', documentId);
      return json({ state: 'FAILED', reason: 'DOWNLOAD_FAILED' }, 200);
    }

    const buf = dl.bytes.slice().buffer as ArrayBuffer;
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
    /* A PDF whose reading stopped before its last page (pdfTextForAnalysis). */
    let stoppedEarly = false;
    try {
      if (kind === 'DOCX') {
        // A .docx is a ZIP; word/document.xml is the body. Everything after
        // the unzip is pure and lives in src/dealroom/domain/docx.ts.
        const zip = await JSZip.loadAsync(bytes);
        const entry = zip.file('word/document.xml');
        if (!entry) throw new Error('no word/document.xml');
        assertDocxParsable(entry);
        raw = extractDocxText(await entry.async('string'));
        // A Word file has no page count until it is laid out, and guessing one
        // would be inventing a fact about the document.
        pages = 0;
      } else {
        const pdf = await getDocumentProxy(bytes);
        pages = pdf.numPages ?? 0;
        /* Only as far as the analysis reads (MAX_DOCUMENT_CHARS); the result is the same text. */
        const read = await pdfTextForAnalysis(pdf);
        raw = read.raw;
        stoppedEarly = pages > 0 && read.pagesRead < pages;
      }
    } catch (e) {
      const tooLarge = e instanceof DocumentTooLarge;
      await supabase
        .from('deal_room_documents')
        .update({
          analysis_state: 'FAILED',
          analysis_error: tooLarge ? `the document is too large to analyse automatically (its text is over ${MAX_DOCX_XML_BYTES / 1024 / 1024} MB)` : 'the document could not be parsed',
          analyzed_at: new Date().toISOString(),
        })
        .eq('id', documentId);
      return json({ state: 'FAILED', reason: tooLarge ? 'TOO_LARGE' : 'PARSE_FAILED', pages });
    }

    const text = normalizeDocumentText(raw);
    // Only the first MAX_DOCUMENT_CHARS were sent to the model: the stored
    // analysis says so, and the page and every export warn the customer.
    const textTruncated = stoppedEarly || documentTextWasTruncated(raw);

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
    // An expired Verify report is not carried into a new analysis (retention).
    const reportExpired = room?.verify_job_id
      ? await retentionBlocked(supabase, 'VERIFY_REPORT', room.verify_job_id).catch(() => true)
      : false;
    if (room?.verify_job_id && !reportExpired) {
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

    /* ---- billing ----
     *
     * Everything above is free: an unchanged document short-circuits at
     * ALREADY_ANALYSED without reaching here, because re-reading an analysis
     * we already hold costs nothing.
     *
     * Below this line the model runs on real money. One Contract Intelligence
     * analysis a month is included on every plan; after that the wallet pays.
     * The tier controls how much of the document the model reasons over, never
     * whether the legal reading is correct: a Standard analysis says the same
     * true things about the same clauses as a Maximum one. */
    const svc = serviceClient();
    svcForRelease = svc;
    const { data: hmUser } = await svc.from('users').select('id').eq('auth_id', userId).maybeSingle();
    if (!hmUser?.id) return json({ error: 'unauthorized' }, 401);

    const analysisStartedAt = Date.now();
    /* SUBSCRIPTIONS (owner decision 2026-10-29). The first successful analysis is free, then the
     * plan's allowance for the period; the old "1 free per month for everyone" is gone
     * (allowIncluded: false). An account that still holds legacy credits may spend them at the
     * fixed price (2026-10-25: 3 credits); nobody can buy new ones. Keyed to the document and its
     * bytes: a retry after a failure re-reserves the same use, and re-running a delivered analysis
     * of the same bytes consumes nothing new. */
    const fixedCredits = await fixedPriceCredits(svc, 'CONTRACT_INTELLIGENCE');
    const grant = await beginEntitled(svc, {
      userId: hmUser.id,
      feature: 'CONTRACT_ANALYSIS',
      key: `contract:${documentId}:${sha}`,
      jobRef: documentId,
      legacy: () => beginExecution(svc, {
        userId: hmUser.id,
        productCode: 'CONTRACT_INTELLIGENCE',
        idempotencyKey: `contract:${hmUser.id}:${sha}`,
        jobRef: documentId,
        allowIncluded: false,
        metadata: { pages, ...(fixedCredits != null ? { fixed_price_credits: fixedCredits } : {}) },
        ...(fixedCredits != null
          ? { authorizedMaxCredits: fixedCredits, budgetIsCeiling: true, requireFullBudget: true }
          : {}),
      }),
    });
    heldGrant = grant.ok ? grant : null;

    if (!grant.ok) {
      const { data: ent } = await svc.rpc('billing_entitlements', { p_user_id: hmUser.id });
      /*
       * A REFUSAL IS A TERMINAL ANSWER, AND IT HAS TO BE A LEGAL ONE.
       *
       * This wrote `analysis_state: 'PENDING'`, which the CHECK constraint on
       * the column does not allow (NONE|QUEUED|RUNNING|DONE|FAILED|
       * UNSUPPORTED|REQUIRES_OCR). The update's error was never inspected, so
       * it failed silently and the row stayed RUNNING — the state set a few
       * lines above. The customer watched "reading your contract" for six
       * minutes until the stale-row sweeper flipped it to FAILED with
       * "analysis stopped before it finished", which is not what happened:
       * nothing was read and nothing was charged, a payment was needed.
       *
       * FAILED is the honest state — the attempt is over — and the reason is
       * carried in analysis_error so the card and the task row can say why in
       * the customer's own language. It stays retryable: canReanalyze()
       * refuses only UNSUPPORTED and REQUIRES_OCR.
       *
       * `NONE` would be wrong for a different reason: jobs-worker maps NONE
       * to QUEUED, so the job would never terminate and the worker would
       * re-dispatch into the same refusal on every tick.
       */
      const { error: refusalErr } = await supabase.from('deal_room_documents')
        .update({
          analysis_state: 'FAILED',
          analysis_error: 'BILLING_REQUIRED',
          analyzed_at: new Date().toISOString(),
        })
        .eq('id', documentId);
      if (refusalErr) console.error('[analyze] could not record billing refusal', refusalErr.message);
      return json({
        state: 'BILLING_REQUIRED',
        // SUBSCRIPTION_REQUIRED / ALLOWANCE_EXHAUSTED: the page turns it into the plans prompt.
        reason: grant.reason ?? 'SUBSCRIPTION_REQUIRED',
        trialBlocked: grant.trialBlocked ?? null,
        walletBalance: Number(ent?.wallet?.balance ?? 0),
      }, grant.reason === 'ERROR' ? 503 : 402);
    }

    const REASONING: Record<string, 'low' | 'medium' | 'high'> = {
      STANDARD: 'low', ENHANCED: 'medium', MAXIMUM: 'high',
    };

    const { system, user } = buildAnalysisPrompt(text, { interestingFactTypes, language });
    let modelText = '';
    let modelUsage: any = null;
    let modelId: string | null = null;
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
          reasoning: { effort: REASONING[grant.legacy?.qualityTier ?? 'STANDARD'] ?? 'low' },
        }),
      });
      if (res.ok) {
        const payload = await res.json();
        modelText = textOf(payload);
        modelUsage = payload?.usage ?? null;
        modelId = payload?.model ?? MODEL;
      }
    } catch {
      // fall through: an empty model response degrades to an empty analysis
      // rather than to invented content.
    }

    // An empty model response is our failure, not the customer's. Charge
    // nothing and give an included slot back.
    if (!modelText) {
      billingClosed = true;
      await releaseGate(svc, grant, 'model_returned_nothing');
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
      textTruncated,
      // The file this analysis was produced from (same value as analysis_sha256).
      documentSha256: sha,
      analysedAt: new Date().toISOString(),
    };
    /* Identity of THIS analysis: contract revisions record it, and a revision
     * saved against another analysis (a forced re-run of the same file gives
     * the same documentSha256) is shown as stale instead of applied. */
    const analysisSha = await sha256Hex(new TextEncoder().encode(JSON.stringify(stored)).buffer as ArrayBuffer);

    /*
     * THE TEXT IS KEPT NOW.
     *
     * It was extracted on every run and thrown away, which is why "view the
     * extracted text" was an action the product could not honestly offer and
     * why re-reading your own contract meant re-buying the extraction. It
     * lives on the row, under exactly the same RLS as the document, and is
     * never logged.
     *
     * headline_summary is what a COLLAPSED card shows. The first line of the
     * extracted text would be a letterhead; the analyser's own first summary
     * sentence is a sentence about the document (§14).
     */
    const headline = (analysis.summary[0] ?? '').slice(0, 300) || null;

    await supabase
      .from('deal_room_documents')
      .update({
        analysis_state: 'DONE',
        analysis_error: null,
        analysis: { ...stored, analysisSha },
        analysis_sha256: sha,
        analyzed_at: new Date().toISOString(),
        state: 'ANALYZED',
        extracted_text: text,
        extracted_pages: pages || null,
        headline_summary: headline,
      })
      .eq('id', documentId);

    /* ---- settle on measured usage ---- */
    let creditsCharged = 0;
    if (modelText) {
      const { data: aiCents } = await svc.rpc('billing_ai_cost_cents', {
        p_model: modelId ?? MODEL,
        p_input_tokens: Number(modelUsage?.input_tokens ?? 0),
        p_cached_tokens: Number(modelUsage?.input_tokens_details?.cached_tokens ?? 0),
        p_output_tokens: Number(modelUsage?.output_tokens ?? 0),
        p_web_search_calls: 0,
      });
      billingClosed = true;
      if (grant.funding !== 'LEGACY_CREDITS' || !grant.legacy) {
        /* Trial / plan: delivered, so the use counts. COGS is still recorded (Finance V2: free to the
         * customer is never free to HOMATCH). */
        await commitEntitled(svc, grant);
        deferCost(recordUsageCost(svc, {
          provider: 'OPENAI',
          operation: 'CONTRACT_ANALYSIS',
          service: 'contract_intelligence',
          model: modelId ?? MODEL,
          correlationId: String(documentId),
          idempotencyKey: `CONTRACT_ANALYSIS:${documentId}:${sha}:${grant.funding}`,
          tokens: tokenUsage({ usage: modelUsage }),
          success: true,
        }));
      } else try {
        const settled = await settleExecution(svc, grant.legacy, {
          // Fixed price: exactly that, whatever the measured cost (which is
          // still recorded as COGS). Absent: the cost-based quote as before.
          ...(fixedCredits != null ? { priceCredits: fixedCredits } : {}),
          provider: 'openai',
          providerOperation: 'contract_analysis',
          model: modelId ?? MODEL,
          inputTokens: Number(modelUsage?.input_tokens ?? 0),
          cachedTokens: Number(modelUsage?.input_tokens_details?.cached_tokens ?? 0),
          outputTokens: Number(modelUsage?.output_tokens ?? 0),
          durationMs: Date.now() - analysisStartedAt,
          aiCostCents: Number(aiCents ?? 0),
          metadata: { pages, quality_tier: grant.legacy.qualityTier, findings: checked.length },
        }, 'SUCCESS');
        creditsCharged = settled.chargedCredits;
      } catch (e) {
        console.error('[document-analyze] settle failed; sweeper will reconcile', e);
      }
    }

    // The customer's own history of their document (§18). Best-effort: a
    // missing history line must never fail an analysis that succeeded.
    try {
      await supabase.from('deal_room_document_events').insert([
        { document_id: documentId, deal_room_id: doc.deal_room_id, user_id: userId,
          event_type: 'EXTRACTION_COMPLETED', detail: { pages, chars: text.length } },
        { document_id: documentId, deal_room_id: doc.deal_room_id, user_id: userId,
          event_type: 'ANALYSIS_COMPLETED',
          detail: { clauses: analysis.clauses.length, findings: checked.length } },
      ]);
    } catch { /* history is bookkeeping, not the result */ }

    /*
     * TOLD ONLY WHEN NOBODY WAS WATCHING.
     *
     * The worker path is the durable one: the browser that asked registered a
     * job and left, and without this the finished analysis waited silently for
     * them to come back. The interactive path is somebody on the page watching
     * the result arrive, and telling them what they are looking at is noise.
     * DOCUMENT_ANALYZED was in the enum and rendered by the centre with no
     * producer. The dedupe key is the document and the file's hash, so a
     * re-analysis of a CHANGED file is news and a retried run is not. No
     * document text or label is copied into the notification.
     */
    if (claimsWorker && hmUser?.id) {
      await notify(svc as never, {
        userId: hmUser.id,
        type: 'DOCUMENT_ANALYZED',
        title: 'Your document has been analysed',
        body: 'The analysis is ready to read.',
        priority: 'NORMAL',
        deepLink: `/contracts/${documentId}`,
        entityType: 'deal_room_document',
        entityId: documentId,
        dedupeKey: `document-analyzed:${documentId}:${sha}`,
        metadata: { kind: 'DOCUMENT_ANALYZED', document_id: documentId, deal_room_id: doc.deal_room_id },
      });
    }

    return json({
      state: 'DONE',
      billing: {
        funding: grant.funding,
        planCode: grant.legacy?.planCode ?? null,
        qualityTier: grant.legacy?.qualityTier ?? 'STANDARD',
        creditsCharged,
      },
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
    // Failed after the hold and before settlement: charge nothing.
    if (heldGrant && !billingClosed && svcForRelease) {
      billingClosed = true;
      await releaseGate(svcForRelease, heldGrant, 'analysis_failed').catch(() => {});
    }
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
