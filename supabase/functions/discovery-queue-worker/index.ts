import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-token',
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json' },
});
const APIFY_API = 'https://api.apify.com/v2';
const DATAFORSEO_API = 'https://api.dataforseo.com/v3/serp/google/organic/live/advanced';
const DEFAULT_ACTORS: Record<string, string> = {
  FACEBOOK: 'lofomachines~facebook-groups-posts-search-scraper',
  TELEGRAM: 'lofomachines~telegram-keyword-search-scraper',
  REDDIT: 'outspoken_strategy~reddit-posts-search-scraper',
  THREADS: 'webdata_labs~threads-scraper',
};

class ProviderError extends Error {
  retryable: boolean;
  status: number;
  constructor(message: string, retryable = true, status = 500) {
    super(message);
    this.retryable = retryable;
    this.status = status;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const baseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const db = createClient(baseUrl, serviceKey);

  try {
    if (!(await isAuthorized(req, db, serviceKey))) return json({ error: 'Internal only' }, 403);
    const body = await req.json().catch(() => ({}));
    const mode = String(body.mode || 'execute').toLowerCase();
    if (mode === 'health' || mode === 'audit') return json(await audit(db));
    if (mode === 'reconcile') {
      const result = await reconcileAlreadyPaidDatasets(db, baseUrl, serviceKey, body);
      return json(result, result.success ? 200 : 500);
    }
    if (mode !== 'execute') return json({ error: 'Unsupported mode' }, 400);
    const result = await executeControlledJobs(db, baseUrl, serviceKey, body);
    return json(result, result.blocked ? 423 : result.success ? 200 : 500);
  } catch (error) {
    return json({ success: false, error: message(error) }, 500);
  }
});

async function isAuthorized(req: Request, db: any, serviceKey: string) {
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (serviceKey && bearer === serviceKey) return true;
  const expected = await setting(db, 'continuous_worker_token', '');
  return !!expected && req.headers.get('x-cron-token') === String(expected);
}

async function audit(db: any) {
  const keys = [
    'external_discovery_enabled', 'provider_kill_switch', 'provider_disabled_list',
    'spend_cap_global', 'spend_cap_dataforseo', 'spend_cap_apify',
    'external_provider_reported_cap_apify', 'external_provider_spend_floor_apify',
    'external_provider_spend_floor_apify_until', 'external_estimated_cost_dataforseo',
    'external_estimated_cost_apify', 'external_consumer_max_results',
  ];
  const { data: rows, error } = await db.from('admin_settings').select('key,value').in('key', keys);
  if (error) throw error;
  const settings = Object.fromEntries((rows || []).map((row: any) => [row.key, scalar(row.value, null)]));
  const statusNames = ['PENDING', 'PROCESSING', 'DONE', 'FAILED'];
  const statusResults = await Promise.all(statusNames.map((status) => db.from('discovery_query_queue').select('id', { count: 'exact', head: true }).eq('status', status)));
  const queueCounts: Record<string, number> = {};
  for (let index = 0; index < statusNames.length; index++) {
    if (statusResults[index].error) throw statusResults[index].error;
    queueCounts[statusNames[index]] = Number(statusResults[index].count || 0);
  }
  const { count: doneWithDataset, error: datasetCountError } = await db.from('discovery_query_queue').select('id', { count: 'exact', head: true }).eq('status', 'DONE').not('dataset_id', 'is', null);
  if (datasetCountError) throw datasetCountError;
  return {
    success: true,
    mode: 'CONTROLLED_EXTERNAL_CONSUMER',
    paidLaunchesEnabled: settings.external_discovery_enabled === true && settings.provider_kill_switch === false,
    settings,
    queue: queueCounts,
    doneWithDataset: Number(doneWithDataset || 0),
    providers: {
      DATAFORSEO: { configured: !!Deno.env.get('DATAFORSEO_LOGIN') && !!Deno.env.get('DATAFORSEO_PASSWORD') },
      APIFY: { configured: !!Deno.env.get('APIFY_API_TOKEN') },
    },
  };
}

async function executeControlledJobs(db: any, baseUrl: string, serviceKey: string, body: any) {
  const propertyId = String(body.propertyId || '');
  if (!propertyId) throw new ProviderError('propertyId required', false, 400);
  const enabled = await setting(db, 'external_discovery_enabled', false);
  const kill = await setting(db, 'provider_kill_switch', true);
  if (enabled !== true || kill !== false) {
    return { success: true, blocked: true, processed: 0, reason: 'EXTERNAL_DISCOVERY_SAFETY_LOCK' };
  }
  const disabledProvidersRaw = await setting(db, 'provider_disabled_list', []);
  const disabledProviders = Array.isArray(disabledProvidersRaw)
    ? disabledProvidersRaw.map((value: unknown) => String(value).toUpperCase())
    : [];
  const configuredMax = Number(await setting(db, 'external_discovery_max_jobs_per_property_tick', 10));
  const requested = Number(body.limit || configuredMax);
  const limit = Math.min(25, Math.max(1, requested || 1));
  const completed: any[] = [];
  const failures: any[] = [];

  for (let index = 0; index < limit; index++) {
    const { data: claimed, error: claimError } = await db.rpc('claim_external_discovery_jobs_for_property', {
      p_property_id: propertyId,
      p_limit: 1,
    });
    if (claimError) throw claimError;
    const job = claimed?.[0];
    if (!job) break;
    await event(db, job, 'CLAIMED', { provider: job.provider, platform: job.platform, estimatedCostUsd: job.estimated_cost_usd });
    try {
      const { data: allowed, error: guardError } = await db.rpc('external_discovery_job_execution_allows', {
        p_job_id: job.id,
        p_claim_token: job.claim_token,
      });
      if (guardError) throw guardError;
      if (allowed !== true) throw new ProviderError('EXECUTION_GUARD_REJECTED', true, 423);
      const execution = await executeProvider(job, Number(await setting(db, 'external_consumer_max_results', 100)), disabledProviders);
      const accountedCost = execution.costUsd > 0 ? execution.costUsd : Number(job.estimated_cost_usd || 0);
      const { data: persisted, error: persistError } = await db.rpc('persist_external_discovery_results', {
        p_job_id: job.id,
        p_results: execution.results,
        p_actual_cost_usd: accountedCost,
        p_external_run_id: execution.externalRunId || null,
        p_dataset_id: execution.datasetId || null,
        p_claim_token: job.claim_token,
        p_reconcile: false,
      });
      if (persistError) throw new ProviderError(`PERSISTENCE_FAILED: ${persistError.message}`, true, 500);
      completed.push({ ...persisted, providerCostUsd: execution.costUsd, accountedCostUsd: accountedCost });
    } catch (error) {
      const failure = error instanceof ProviderError ? error : new ProviderError(message(error), true, 500);
      await failJob(db, job, failure);
      failures.push({ jobId: job.id, provider: job.provider, retryable: failure.retryable, error: failure.message });
    }
  }

  if (completed.length) await invokeMatching(baseUrl, serviceKey, propertyId, body.campaignId || null);
  return { success: failures.length === 0, blocked: false, processed: completed.length + failures.length, completed, failures };
}

async function executeProvider(job: any, maxResults: number, disabledProviders: string[] = []) {
  const provider = String(job.provider || '').toUpperCase();
  // Per-provider admin disable (AdminProvidersPage's per-card toggle, backed by
  // admin_settings.provider_disabled_list) used to be read here but never
  // actually enforced — a provider an admin had switched off in the UI would
  // still run. The master provider_kill_switch above is a separate, coarser
  // circuit breaker; this is the finer-grained one the admin UI promises.
  if (disabledProviders.includes(provider)) {
    throw new ProviderError(`PROVIDER_DISABLED_BY_ADMIN: ${provider}`, false, 423);
  }
  if (provider === 'DATAFORSEO') return executeDataForSEO(job, maxResults);
  if (provider === 'APIFY') return executeApify(job, maxResults);
  throw new ProviderError(`UNSUPPORTED_PROVIDER: ${provider}`, false, 400);
}

async function executeDataForSEO(job: any, maxResults: number) {
  const login = Deno.env.get('DATAFORSEO_LOGIN') || '';
  const password = Deno.env.get('DATAFORSEO_PASSWORD') || '';
  if (!login || !password) throw new ProviderError('DATAFORSEO_NOT_CONFIGURED', false, 503);
  const keyword = scopedSearchQuery(job);
  const language = normalizeLanguage(job.language);
  const payload = [{
    keyword,
    location_name: String(job.metadata?.location_name || job.metadata?.country_name || 'Georgia'),
    language_code: language,
    depth: Math.min(100, Math.max(10, maxResults)),
    device: 'desktop',
    os: 'windows',
  }];
  const response = await fetch(DATAFORSEO_API, {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${login}:${password}`)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(90000),
  });
  const text = await response.text();
  if (!response.ok) throw httpProviderError('DATAFORSEO', response.status, text);
  let data: any;
  try { data = JSON.parse(text); } catch { throw new ProviderError('DATAFORSEO_INVALID_JSON', true, 502); }
  const task = data?.tasks?.[0];
  const statusCode = Number(task?.status_code || 0);
  if (statusCode < 20000 || statusCode >= 20100) {
    throw new ProviderError(`DATAFORSEO_TASK_${statusCode}: ${String(task?.status_message || 'failed')}`, statusCode >= 50000, 502);
  }
  const items = (task?.result || []).flatMap((result: any) => Array.isArray(result?.items) ? result.items : [])
    .filter((item: any) => item?.type === 'organic')
    .slice(0, maxResults);
  const results = items.map((item: any) => ({
    platform: 'GOOGLE',
    external_id: String(item.url || item.absolute_url || item.rank_absolute || ''),
    source_url: item.url || item.absolute_url || null,
    source_root_url: item.domain ? `https://${item.domain}/` : 'https://google.com/',
    source_external_id: item.domain || 'google-search',
    source_name: item.domain || 'Google Search',
    title: item.title || null,
    snippet: item.description || item.snippet || null,
    text: [item.title, item.description || item.snippet].filter(Boolean).join('\n'),
    domain: item.domain || null,
    rank_position: Number(item.rank_absolute || item.rank_group || 0) || null,
    language: job.language || language,
    published_at: normalizeDate(item.timestamp || item.date || null),
    provider_task_id: task.id || null,
  })).filter((item: any) => item.text.trim().length >= 5);
  return {
    results,
    costUsd: Number(task?.cost || data?.cost || 0),
    externalRunId: task?.id || null,
    datasetId: null,
  };
}

async function executeApify(job: any, maxResults: number) {
  const token = Deno.env.get('APIFY_API_TOKEN') || '';
  if (!token) throw new ProviderError('APIFY_NOT_CONFIGURED', false, 503);
  const platform = String(job.platform || '').toUpperCase();
  const actorId = String(job.actor_id || DEFAULT_ACTORS[platform] || '');
  if (!actorId) throw new ProviderError(`APIFY_ACTOR_NOT_CONFIGURED: ${platform}`, false, 503);
  const start = await apifyRequest(`${APIFY_API}/acts/${actorId}/runs?memory=512&timeout=600`, token, {
    method: 'POST',
    body: JSON.stringify(actorInput(job, maxResults)),
    headers: { 'Content-Type': 'application/json' },
    timeout: 30000,
  });
  let run = start?.data || start;
  const runId = String(run?.id || '');
  if (!runId) throw new ProviderError('APIFY_RUN_ID_MISSING', true, 502);
  const deadline = Date.now() + 170000;
  while (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(String(run?.status || '').toUpperCase()) && Date.now() < deadline) {
    await delay(4000);
    const polled = await apifyRequest(`${APIFY_API}/actor-runs/${runId}`, token, { timeout: 20000 });
    run = polled?.data || polled;
  }
  const status = String(run?.status || '').toUpperCase();
  if (status !== 'SUCCEEDED') throw new ProviderError(`APIFY_RUN_${status || 'INCOMPLETE'}: ${runId}`, status === 'TIMED-OUT', 502);
  const datasetId = String(run?.defaultDatasetId || '');
  if (!datasetId) throw new ProviderError('APIFY_DATASET_ID_MISSING', true, 502);
  const items = await fetchApifyDataset(token, datasetId, Math.min(500, maxResults));
  const results = items.map((item: any) => normalizeApifyItem(job, item)).filter((item: any) => item.text.length >= 5);
  return {
    results,
    costUsd: apifyRunCost(run),
    externalRunId: runId,
    datasetId,
  };
}

async function reconcileAlreadyPaidDatasets(db: any, baseUrl: string, serviceKey: string, body: any) {
  const token = Deno.env.get('APIFY_API_TOKEN') || '';
  if (!token) return { success: false, mode: 'reconcile', error: 'APIFY_NOT_CONFIGURED' };
  const configured = Number(await setting(db, 'external_reconcile_batch_size', 10));
  const limit = Math.min(25, Math.max(1, Number(body.limit || configured)));
  const maxResults = Math.min(500, Math.max(1, Number(await setting(db, 'external_consumer_max_results', 100))));
  let query = db.from('discovery_query_queue').select('*').eq('status', 'DONE').eq('provider', 'APIFY').not('dataset_id', 'is', null).order('result_count', { ascending: false }).order('finished_at', { ascending: false }).limit(1000);
  if (body.propertyId) query = query.eq('property_id', String(body.propertyId));
  const { data: rows, error } = await query;
  if (error) throw error;
  const candidates = (rows || []).filter((row: any) => !row.metadata?.reconciled_at && (body.retryFailures === true || !row.metadata?.reconcile_attempted_at)).slice(0, limit);
  const reconciled: any[] = [];
  const failures: any[] = [];
  const touched = new Set<string>();

  for (const job of candidates) {
    try {
      const items = await fetchApifyDataset(token, job.dataset_id, maxResults);
      const results = items.map((item: any) => normalizeApifyItem(job, item)).filter((item: any) => item.text.length >= 5);
      if (Number(job.result_count || 0) > 0 && results.length === 0) throw new ProviderError('APIFY_DATASET_EMPTY_BUT_JOB_EXPECTED_RESULTS', false, 409);
      const { data: persisted, error: persistError } = await db.rpc('persist_external_discovery_results', {
        p_job_id: job.id,
        p_results: results,
        p_actual_cost_usd: 0,
        p_external_run_id: job.external_run_id || null,
        p_dataset_id: job.dataset_id,
        p_claim_token: null,
        p_reconcile: true,
      });
      if (persistError) throw persistError;
      reconciled.push(persisted);
      touched.add(job.property_id);
    } catch (reconcileError) {
      const errorText = message(reconcileError).slice(0, 500);
      failures.push({ jobId: job.id, datasetId: job.dataset_id, error: errorText });
      await db.from('discovery_query_queue').update({ metadata: { ...(job.metadata || {}), reconcile_error: errorText, reconcile_attempted_at: new Date().toISOString() } }).eq('id', job.id);
      await event(db, job, 'DATASET_RECONCILE_FAILED', { datasetId: job.dataset_id, error: errorText });
    }
  }
  for (const propertyId of touched) await invokeMatching(baseUrl, serviceKey, propertyId, null);
  return { success: failures.length === 0, mode: 'reconcile', paidActorLaunches: 0, scanned: candidates.length, reconciled, failures };
}

async function fetchApifyDataset(token: string, datasetId: string, limit: number) {
  const response = await fetch(`${APIFY_API}/datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json&limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(60000),
  });
  const text = await response.text();
  if (!response.ok) throw httpProviderError('APIFY_DATASET', response.status, text);
  let data: any;
  try { data = JSON.parse(text); } catch { throw new ProviderError('APIFY_DATASET_INVALID_JSON', true, 502); }
  return Array.isArray(data) ? data : [];
}

async function apifyRequest(url: string, token: string, options: { method?: string; body?: string; headers?: Record<string,string>; timeout?: number }) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
    body: options.body,
    signal: AbortSignal.timeout(options.timeout || 30000),
  });
  const text = await response.text();
  if (!response.ok) throw httpProviderError('APIFY', response.status, text);
  try { return JSON.parse(text); } catch { throw new ProviderError('APIFY_INVALID_JSON', true, 502); }
}

function actorInput(job: any, maxResults: number) {
  const query = String(job.query || '');
  const language = normalizeLanguage(job.language);
  const platform = String(job.platform || '').toUpperCase();
  if (platform === 'FACEBOOK') return { keywords: [query], afterDate: 'last_month', maxPosts: maxResults, countryCode: 'ge' };
  if (platform === 'TELEGRAM') return { mode: 'keyword', keywords: [query], afterDate: '1 month', countryCode: 'ge', languageCode: language, maxResultsPerKeyword: maxResults };
  if (platform === 'THREADS') return { mode: 'search', searchQueries: [query], maxPosts: maxResults, postedAfter: new Date(Date.now() - 30 * 86400000).toISOString() };
  if (platform === 'REDDIT') return { queries: [query], sort: 'new', numberOfPosts: maxResults, timeFilter: 'month', proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'], apifyProxyCountry: 'US' } };
  return { query, maxResults };
}

function normalizeApifyItem(job: any, item: any) {
  const platform = String(job.platform || '').toUpperCase();
  const text = String(item.text || item.message || item.post_text || item.content || item.selftext || item.body || item.title || item.caption || '').trim();
  const url = item.post_url || item.messageUrl || item.message_url || item.source_url || item.permalink || item.url || null;
  const source = sourceInfo(platform, item, url);
  return {
    platform,
    external_id: String(item.id || item.message_id || item.messageId || item.postId || item.facebookId || url || fingerprintSeed(platform, text)),
    source_url: url,
    source_root_url: source.url,
    source_external_id: source.externalId,
    source_name: source.name,
    author_name: item.author_name || item.author || item.username || item.source_name || item.user?.name || null,
    author_url: item.author_url || item.authorUrl || item.channelUrl || item.authorProfileUrl || item.user?.profileUrl || null,
    profile_url: item.profileUrl || item.authorProfileUrl || null,
    text,
    title: item.title || null,
    snippet: item.description || item.snippet || null,
    language: job.language || item.language || null,
    published_at: normalizeDate(item.date || item.published_at || item.publishedAt || item.created_at || item.createdAt || item.createdUtc || item.created_utc || item.timestamp || item.time),
    domain: domainOf(url),
  };
}

function sourceInfo(platform: string, item: any, fallbackUrl: string | null) {
  if (platform === 'FACEBOOK') {
    const url = canonicalFacebook(item.group_url || item.groupUrl || item.inputUrl || fallbackUrl || '');
    return { url: url || 'https://facebook.com/groups/', externalId: String(item.group_id || url || 'facebook-groups'), name: String(item.group_name || item.groupName || url || 'Facebook Groups') };
  }
  if (platform === 'TELEGRAM') {
    const url = canonicalTelegram(item.channelUrl || item.channel_url || item.source_url || item.sourceUrl || fallbackUrl || '');
    return { url: url || 'https://t.me/', externalId: String(item.source_id || url || 'telegram-search'), name: String(item.channelTitle || item.channel_title || item.source_name || url || 'Telegram') };
  }
  if (platform === 'REDDIT') {
    const subreddit = String(item.subreddit || '').replace(/^r\//, '');
    const url = subreddit ? `https://www.reddit.com/r/${subreddit}/` : 'https://reddit.com/';
    return { url, externalId: subreddit || domainOf(fallbackUrl) || 'reddit', name: subreddit ? `r/${subreddit}` : 'Reddit' };
  }
  if (platform === 'THREADS') {
    const username = String(item.username || item.author || '').replace(/^@/, '');
    const url = username ? `https://www.threads.net/@${username}` : 'https://threads.net/';
    return { url, externalId: username || 'threads', name: username ? `@${username}` : 'Threads' };
  }
  const domain = domainOf(fallbackUrl) || platform.toLowerCase();
  return { url: fallbackUrl || 'https://www.homatch.online/', externalId: domain, name: domain };
}

async function failJob(db: any, job: any, error: ProviderError) {
  const text = error.message.slice(0, 1000);
  await db.rpc('fail_external_discovery_job', {
    p_job_id: job.id,
    p_claim_token: job.claim_token,
    p_error: text,
    p_retryable: error.retryable,
  });
  await db.from('cost_events').insert({
    provider: String(job.provider || '').toUpperCase(),
    operation_type: 'EXTERNAL_DISCOVERY_FAILED',
    source: `queue:${job.id}`,
    market: job.metadata?.country_code || 'GE',
    units: 0,
    cost_usd: 0,
    success: false,
    cache_hit: false,
    property_id: job.property_id,
    discovery_job_id: job.id,
  });
  await event(db, job, 'FAILED', { provider: job.provider, retryable: error.retryable, error: text });
  if (/usage.{0,20}(limit|exceed)|platform usage|billing|payment|required|unauthori[sz]ed|invalid credential/i.test(text)) {
    await db.from('admin_settings').update({ value: true, updated_at: new Date().toISOString() }).eq('key', 'provider_kill_switch');
  }
}

async function event(db: any, job: any, eventType: string, payload: any) {
  const { error } = await db.from('external_discovery_events').insert({ job_id: job.id, property_id: job.property_id, event_type: eventType, payload });
  if (error) console.error('external_discovery_event', error.message);
}

async function invokeMatching(baseUrl: string, serviceKey: string, propertyId: string, campaignId: string | null) {
  try {
    const response = await fetch(`${baseUrl}/functions/v1/run-matching-v2`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ propertyId, campaignId, intentProfileBatchSize: 2500 }),
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) console.error('run-matching-v2', response.status, (await response.text()).slice(0, 500));
  } catch (error) { console.error('run-matching-v2', message(error)); }
}

function scopedSearchQuery(job: any) {
  const query = String(job.query || '').trim();
  const platform = String(job.platform || '').toUpperCase();
  const domains: Record<string, string> = { VK: 'vk.com', INSTAGRAM: 'instagram.com', FACEBOOK: 'facebook.com', TELEGRAM: 't.me', REDDIT: 'reddit.com', THREADS: 'threads.net' };
  return domains[platform] && !/\bsite:/i.test(query) ? `site:${domains[platform]} ${query}` : query;
}

function httpProviderError(provider: string, status: number, text: string) {
  const body = text.slice(0, 500);
  const permanent = status === 400 || status === 401 || status === 403 || status === 404 || /usage.{0,20}(limit|exceed)|platform usage|billing|payment required/i.test(body);
  return new ProviderError(`${provider}_${status}: ${body}`, !permanent && (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500), status);
}

async function setting(db: any, key: string, fallback: any) {
  const { data, error } = await db.from('admin_settings').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  return scalar(data?.value, fallback);
}
function scalar(value: any, fallback: any) { if (value === null || value === undefined) return fallback; if (typeof value === 'string') { try { return JSON.parse(value); } catch { return value; } } return value; }
function normalizeLanguage(value: any) { const code = String(value || 'en').toLowerCase().split(/[-_]/)[0]; return /^[a-z]{2}$/.test(code) ? code : 'en'; }
function normalizeDate(value: any) { if (value === null || value === undefined || value === '') return null; const date = typeof value === 'number' ? new Date(value > 1e12 ? value : value * 1000) : new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function domainOf(value: any) { try { return new URL(String(value || '')).hostname.replace(/^www\./, ''); } catch { return ''; } }
function canonicalFacebook(value: string) { try { const url = new URL(value); const match = url.pathname.match(/\/groups\/([^/]+)/); return match ? `https://www.facebook.com/groups/${match[1]}/` : ''; } catch { return ''; } }
function canonicalTelegram(value: string) { try { const url = new URL(value); const first = url.pathname.split('/').filter(Boolean)[0]; return first ? `https://t.me/${first}` : ''; } catch { return ''; } }
function fingerprintSeed(platform: string, text: string) { let hash = 2166136261; for (const char of `${platform}:${text}`) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); } return `content-${(hash >>> 0).toString(16)}`; }
function apifyRunCost(run: any) { const direct = Number(run?.usageTotalUsd || run?.usageUsd || run?.stats?.usageTotalUsd || 0); return Number.isFinite(direct) && direct > 0 ? direct : 0; }
function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
function delay(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
