// HOMATCH Verify — open one official TAS file through the secure viewer.
//
// research-agent `document_file` checks the caller owns the report and that
// the file is a viewable entry of its document ledger, fetches it once via
// the official worker, caches it privately and returns a signed URL valid for
// a few minutes. A fresh URL is requested on every click, so an old tab never
// holds an expired link. No charge.

import { supabase } from '@/db/supabase';

export type DocumentFileError = 'sign_in_required' | 'not_found' | 'not_viewable' | 'source_unavailable' | 'failed';

export async function requestDocumentFileUrl(jobId: string, attachedFileId: string): Promise<{ url: string } | { error: DocumentFileError }> {
  try {
    const { data, error } = await supabase.functions.invoke('research-agent', {
      body: { action: 'document_file', jobId, attachedFileId },
    });
    if (error || !data?.url) {
      let body: { error?: string } | null = (data as { error?: string } | null) ?? null;
      const ctx = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context;
      if (!body?.error && ctx && typeof ctx.json === 'function') body = ((await ctx.json().catch(() => null)) as { error?: string } | null) ?? null;
      const code = String(body?.error ?? '');
      if (code === 'sign_in_required' || code === 'not_found' || code === 'not_viewable' || code === 'source_unavailable') return { error: code };
      return { error: 'failed' };
    }
    return { url: String(data.url) };
  } catch {
    return { error: 'failed' };
  }
}

/**
 * Open the file in a new tab. The tab is opened synchronously inside the
 * click (so no popup blocker swallows it) and pointed at the signed URL once
 * it arrives; on failure it is closed again and the caller shows the reason.
 */
export async function openDocumentFile(jobId: string, attachedFileId: string): Promise<DocumentFileError | null> {
  let tab: Window | null = null;
  try {
    tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
  } catch {
    tab = null;
  }
  const r = await requestDocumentFileUrl(jobId, attachedFileId);
  if ('error' in r) {
    try { tab?.close(); } catch { /* ignore */ }
    return r.error;
  }
  if (tab && !tab.closed) tab.location.href = r.url;
  else window.open(r.url, '_blank', 'noopener,noreferrer');
  return null;
}
