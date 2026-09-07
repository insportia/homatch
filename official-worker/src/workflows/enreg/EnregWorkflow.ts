import fs from 'node:fs';
import pdf from 'pdf-parse';
import type { BrowserContext, Frame, Page } from 'playwright';
import { BrowserTrace } from '../../browser/BrowserTrace.js';
import { computeEnregTraversal } from '../../state/transitions.js';
import { WorkflowPreconditionError } from '../../errors/WorkflowErrors.js';
import type { EntityQueue } from '../../entities/EntityQueue.js';
import { looksLikeCompanyId } from '../../entities/EntityValidation.js';
import type { LegacySourceResult, WorkflowResult } from '../WorkflowResult.js';

const SOURCE_URL = 'https://my.gov.ge/ka-ge/services/10/service/179';
const SOURCE_META = {
  name: 'Official Government Sources',
  class: 'OFFICIAL_GOVERNMENT',
  url: SOURCE_URL,
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const clean = (v: unknown) => String(v || '').replace(/\s+/g, ' ').trim();

async function findService179Frame(page: Page): Promise<Frame> {
  for (let i = 0; i < 120; i++) {
    for (const frame of page.frames()) {
      const input = frame.locator('#s_legal_person_idnumber').first();
      if ((await input.count().catch(() => 0)) && (await input.isVisible().catch(() => false))) {
        return frame;
      }
    }
    await sleep(500);
  }
  throw new Error('SERVICE_179_FRAME_NOT_FOUND');
}

async function waitForNewPage(context: BrowserContext, before: Set<Page>, timeout = 12000): Promise<Page | null> {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    for (const p of context.pages()) if (!before.has(p)) return p;
    await sleep(100);
  }
  return null;
}

async function readPdf(buffer: Buffer, source: string) {
  const parsed = await pdf(buffer);
  const pageCount = Number(parsed.numpages || 0);
  const rawText = String(parsed.text || '');
  if (pageCount <= 0 || !rawText.trim()) throw new Error('PDF_READ_INCOMPLETE');
  return {
    url: source,
    label: 'Official extract',
    documentType: 'PDF_DOCUMENT',
    sourceCategory: 'OFFICIAL_DOCUMENT',
    evidenceLevel: 'OFFICIAL',
    retrievalMethod: 'DOCUMENT_RETRIEVED_AND_PARSED',
    pageCount,
    pagesRead: pageCount,
    rawText,
    textExtracted: true,
    complete: true,
  };
}

async function readHttp(page: Page, url: string) {
  const response = await page.request.get(url, { timeout: 30000 });
  const buffer = await response.body();
  const contentType = String(response.headers()['content-type'] || '').toLowerCase();
  if (contentType.includes('pdf') || buffer.subarray(0, 4).toString() === '%PDF') {
    return await readPdf(buffer, url);
  }
  const rawText = buffer.toString('utf8');
  return {
    url,
    label: 'Official document',
    documentType: 'ONLINE_DOCUMENT',
    sourceCategory: 'OFFICIAL_DOCUMENT',
    evidenceLevel: 'OFFICIAL',
    retrievalMethod: 'DOCUMENT_RETRIEVED_AND_PARSED',
    rawText,
    textExtracted: !!rawText.trim(),
    complete: !!rawText.trim(),
  };
}

async function readAfterSignedClick(
  context: BrowserContext,
  hostPage: Page,
  beforePages: Set<Page>,
  downloadPromise: Promise<any>,
) {
  const download = await Promise.race([downloadPromise, sleep(3000).then(() => null)]).catch(() => null);
  if (download) {
    const path = await download.path().catch(() => null);
    if (path) {
      const buffer = fs.readFileSync(path);
      if (buffer.subarray(0, 4).toString() === '%PDF') return await readPdf(buffer, path);
    }
  }

  const child = await waitForNewPage(context, beforePages, 12000);
  if (child) {
    await child.waitForLoadState('commit', { timeout: 10000 }).catch(() => {});
    await sleep(500);
    const url = child.url();
    if (url.startsWith('http://') || url.startsWith('https://')) return await readHttp(child, url);
    const rawText = await child.locator('body').innerText().catch(() => '');
    return {
      url,
      label: 'Official document',
      documentType: 'ONLINE_DOCUMENT',
      sourceCategory: 'OFFICIAL_DOCUMENT',
      evidenceLevel: 'OFFICIAL',
      retrievalMethod: 'DOCUMENT_RETRIEVED_AND_PARSED',
      rawText,
      textExtracted: !!rawText.trim(),
      complete: !!rawText.trim(),
    };
  }

  for (const p of context.pages()) {
    const url = p.url();
    if (/\.pdf(\?|$)/i.test(url) || /GetBlob/i.test(url)) return await readHttp(p, url);
  }

  throw new Error('SIGNED_DOCUMENT_CLICKED_BUT_NOT_CAPTURED');
}

export async function runEnregWorkflow(
  page: Page,
  rawEntity: { name: string; idCode: string | null } | null,
  entities?: EntityQueue,
  opts: { skipGoto?: boolean } = {},
): Promise<LegacySourceResult> {
  const trace = new BrowserTrace('enreg');
  const forEntity = rawEntity
    ? { name: rawEntity.name, idCode: looksLikeCompanyId(rawEntity.idCode) ? rawEntity.idCode : null }
    : null;
  const idCode = forEntity?.idCode ? String(forEntity.idCode).trim() : null;

  if (!forEntity || !idCode) {
    const err = new WorkflowPreconditionError('enreg', 'no company identification code supplied');
    trace.record({ stateBefore: 'START', action: 'PRECONDITION_CHECK', actualOutcome: 'MISSING_ID_CODE', stateAfter: 'START', error: err.message });
    return buildResult('START', idCode, false, false, [], trace, err.message, false);
  }

  try {
    if (!opts.skipGoto) {
      await page.goto(SOURCE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
      trace.record({ stateBefore: 'START', action: 'GOTO', target: SOURCE_URL, actualOutcome: 'NAVIGATED', stateAfter: 'ENREG_OPENED' });
    }

    const frame = await findService179Frame(page);
    const input = frame.locator('#s_legal_person_idnumber').first();
    await input.fill(idCode);
    trace.record({ stateBefore: 'ENREG_OPENED', action: 'FILL_ID_CODE', target: idCode, actualOutcome: 'FILLED', stateAfter: 'SEARCH_VALUE_ENTERED' });

    const search = frame.locator('#s_search_persons_form > div > button.submit_button').first();
    await search.waitFor({ state: 'visible', timeout: 15000 });
    await search.click({ force: true });
    trace.record({ stateBefore: 'SEARCH_VALUE_ENTERED', action: 'CLICK_SEARCH', actualOutcome: 'CLICKED', stateAfter: 'SEARCH_SUBMITTED' });
    await sleep(1500);

    const rows = frame.locator('#content > table > tbody > tr');
    const count = await rows.count();
    let companyRow: any = null;
    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      const rowText = clean(await row.innerText().catch(() => ''));
      if (rowText.includes(idCode)) {
        companyRow = row;
        break;
      }
    }

    if (!companyRow) {
      const bodyText = await frame.locator('body').innerText().catch(() => '');
      const explicitZero = /მონაცემ(ი|ები).*ვერ მოიძებნა|არ მოიძებნა|no\s+data|not\s+found/i.test(bodyText);
      if (explicitZero) return buildResult('NO_RESULT_CONFIRMED', idCode, false, false, [], trace, null, false);
      return buildResult('SEARCH_SUBMITTED', idCode, false, false, [], trace, 'exact company row not found', false);
    }

    trace.record({ stateBefore: 'SEARCH_SUBMITTED', action: 'MATCH_EXACT_COMPANY', target: idCode, actualOutcome: 'MATCHED', stateAfter: 'CORRECT_ENTITY_MATCHED' });

    const info = companyRow.locator('td:nth-child(1) > a > img[src*="info.png"]').first();
    await info.waitFor({ state: 'visible', timeout: 15000 });
    await info.click({ force: true });
    await sleep(1200);
    trace.record({ stateBefore: 'CORRECT_ENTITY_MATCHED', action: 'CLICK_INFO', actualOutcome: 'CLICKED', stateAfter: 'ENTITY_PAGE_READ' });

    const companyDetailText = await frame.locator('body').innerText().catch(() => '');
    if (entities && companyDetailText) {
      entities.scanText(companyDetailText, { source: 'enreg', sourceDocument: SOURCE_URL, retrievedAt: new Date().toISOString() });
    }

    const blob = frame.locator('#tabs-1 > table > tbody > tr:nth-child(1) > td:nth-child(1) > a > img[src*="blob.png"]').first();
    await blob.waitFor({ state: 'visible', timeout: 15000 });
    await blob.locator('xpath=..').click({ force: true });
    await sleep(1200);
    trace.record({ stateBefore: 'ENTITY_PAGE_READ', action: 'OPEN_APPLICATION', actualOutcome: 'CLICKED', stateAfter: 'APPLICATION_PAGE_READ' });

    const applicationDetailText = await frame.locator('body').innerText().catch(() => '');
    if (entities && applicationDetailText) {
      entities.scanText(applicationDetailText, { source: 'enreg', sourceDocument: SOURCE_URL, retrievedAt: new Date().toISOString() });
    }

    const signed = frame.locator('#tabs-3 > div:nth-child(1) > table:nth-child(4) > tbody > tr > td:nth-child(1) > a > img[alt="SIGNED"]').first();
    await signed.waitFor({ state: 'visible', timeout: 20000 });
    const signedLink = signed.locator('xpath=..');
    const beforePages = new Set(page.context().pages());
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
    await signedLink.scrollIntoViewIfNeeded().catch(() => {});
    await signedLink.click({ force: true, timeout: 10000 });
    trace.record({ stateBefore: 'APPLICATION_PAGE_READ', action: 'OPEN_SIGNED_EXTRACT', actualOutcome: 'CLICKED', stateAfter: 'REGISTRY_EXTRACT_OPENED' });

    const doc = await readAfterSignedClick(page.context(), page, beforePages, downloadPromise);
    if (!doc.complete) throw new Error('DOCUMENT_INCOMPLETE');
    trace.record({ stateBefore: 'REGISTRY_EXTRACT_OPENED', action: 'READ_FULL_EXTRACT', actualOutcome: 'COMPLETE', stateAfter: 'ENREG_EXHAUSTED' });

    if (entities && doc.rawText) {
      entities.scanText(doc.rawText, { source: 'enreg', sourceDocument: doc.url, retrievedAt: new Date().toISOString() });
    }

    return buildResult('ENREG_EXHAUSTED', idCode, true, true, [doc], trace, null, true, {
      companyDetailText,
      applicationDetailText,
    });
  } catch (e) {
    return buildResult('FAILED', idCode, false, false, [], trace, String(e), false);
  }

  function buildResult(
    state: string,
    value: string | null,
    matched: boolean,
    infoIconClicked: boolean,
    documents: any[],
    tr: BrowserTrace,
    error: string | null,
    fullChain: boolean,
    context?: { companyDetailText?: string; applicationDetailText?: string },
  ): LegacySourceResult {
    const traversal = computeEnregTraversal({
      searchMethod: value ? 'ID_CODE' : null,
      searchValue: value,
      exactEntityMatched: matched,
      infoIconClicked,
      entityPageOpened: matched && infoIconClicked,
      latestApplicationDate: null,
      latestApplicationOpened: fullChain,
      preparedDocumentsOpened: fullChain,
      latestRegistryExtractOpened: fullChain,
      fullExtractRead: fullChain,
      historicalRelevantRecordsRead: fullChain,
      searchControlNotFound: false,
      submitFailed: false,
      captcha: false,
      failed: state === 'FAILED',
      noResultConfirmed: state === 'NO_RESULT_CONFIRMED',
    });
    const legacyStatus = state === 'ENREG_EXHAUSTED' ? 'SEARCH_CONFIRMED' : state;
    const workflowResult: WorkflowResult = {
      source: 'enreg',
      state,
      completed: state === 'ENREG_EXHAUSTED',
      skipped: false,
      discoveredItems: matched ? 1 : 0,
      visitedItems: infoIconClicked ? 1 : 0,
      discoveredDocuments: documents.length,
      readDocuments: documents.filter((d: any) => d.complete).length,
      unvisitedRelevantItems: matched && state !== 'ENREG_EXHAUSTED' ? 1 : 0,
      evidenceIds: [],
      trace: tr.all,
    };
    return {
      source: 'enreg',
      sourceName: SOURCE_META.name,
      sourceClass: SOURCE_META.class,
      sourceUrl: SOURCE_META.url,
      startUrl: SOURCE_META.url,
      finalUrl: SOURCE_META.url,
      frameUrls: page.frames().map((f) => f.url()),
      searchControlUsed: value ? '#s_legal_person_idnumber' : null,
      queryEntered: value,
      submitAction: value ? 'CLICK #s_search_persons_form button.submit_button' : null,
      resultContext: error || context?.applicationDetailText || context?.companyDetailText || `Official government source reached ${state}`,
      resultConfirmed: legacyStatus === 'SEARCH_CONFIRMED',
      noResultConfirmed: legacyStatus === 'NO_RESULT_CONFIRMED',
      resultValidated: legacyStatus === 'SEARCH_CONFIRMED',
      status: legacyStatus,
      traversal,
      retrievedAt: new Date().toISOString(),
      documents,
      discoveredEntities: [],
      forEntity,
      error,
      workflowResult,
    };
  }
}
