export function publishingStatusKey(status: string) {
  const phase =
    (
      {
        running: 'preparing',
        retry: 'queued',
        succeeded: 'published',
        dead_letter: 'failed',
        draft: 'preparing',
        expired: 'action_required',
        disconnected: 'disconnected',
        connected: 'connected',
      } as Record<string, string>
    )[status] ?? status;
  return [
    'preparing',
    'validating',
    'connecting',
    'uploading',
    'submitting',
    'reconciling',
    'awaiting_moderation',
    'published',
    'action_required',
    'failed',
    'queued',
    'cancelled',
    'removed',
    'inactive',
    'disconnected',
    'connected',
  ].includes(phase)
    ? `pub_${phase}`
    : 'pub_action_required';
}
export function originalListingUrl(
  url: string | null,
  domain: string | undefined,
) {
  if (!url || !domain) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port &&
      (parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`))
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}
