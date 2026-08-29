/**
 * discovery-queue-worker — Phase 6 hardened rewrite
 *
 * Property-scoped claims via claim_discovery_jobs_scoped RPC (SKIP LOCKED).
 * Server-side safety gate checked BEFORE any provider call.
 * Bounded batches from admin_settings.max_jobs_per_property_tick.
 * Claim-token-gated completion via complete_discovery_job RPC.
 * Dry-run: full simulation, zero real provider calls, $0 cost.
 *
 * SAFETY INVARIANT: external_discovery_enabled=false + kill_switch=true
 * means this function returns immediately with no real provider calls.
 *
 * Queue table: discovery_query_queue (Phase 6b migration)
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-token',
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

// Apify actor IDs per platform
const ACTORS: Record<string, string> = {
  FACEBOOK: 'lofomachines~facebook-groups-posts-search-scraper',
  TELEGRAM: 'lofomachines~telegram-keyword-search-scraper',
  REDDIT:   'outspoken_strategy~reddit-posts-search-scraper',
  THREADS:  'webdata_labs~threads-scraper',
};
const TERMINAL = new Set(['SUCCEEDED','FAILED','ABORTED','TIMED-OUT']);
const WEB_PLATFORMS = new Set(['WEB','VK','INSTAGRAM']);
const ACTOR_PLATFORMS = new Set(['FACEBOOK','TELEGRAM','REDDIT','THREADS']);

// ── Settings loader ───────────────────────────────────────────────
interface QueueSettings {
  external_discovery_enabled: boolean;
  provider_kill_switch: boolean;
  dry_run_mode: boolean;
  max_jobs: number;
}

async function loadQueueSettings(db: ReturnType<typeof createClient>): Promise<QueueSettings> {
  const { data } = await db.from('admin_settings').select('key,value')
    .in('key',['external_discovery_enabled','provider_kill_switch','dry_run_mode','max_jobs_per_property_tick']);
  const raw: Record<string,string> = {};
  for (const r of data ?? []) raw[r.key] = String(r.value ?? '').replace(/^"|"$/g,'');
  return {
    external_discovery_enabled: raw['external_discovery_enabled'] === 'true',
    provider_kill_switch:        raw['provider_kill_switch'] !== 'false',
    dry_run_mode:                raw['dry_run_mode'] === 'true',
    max_jobs:                    Math.max(1, Math.min(28, Number(raw['max_jobs_per_property_tick'] ?? 10))),
  };
}

// ── Main handler ──────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const base  = Deno.env.get('SUPABASE_URL')!;
  const key   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const apify = Deno.env.get('APIFY_API_TOKEN') ?? '';
  const db    = createClient(base, key);

  try {
    // Internal-only: called by continuous-matching-worker with service role
    const auth = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (auth !== key) return json({ error: 'Internal only' }, 403);

    const body       = await req.json().catch(() => ({}));
    const propertyId = String(body.propertyId ?? '');
    if (!propertyId) return json({ error: 'propertyId required' }, 400);
    const runId   = String(body.runId ?? crypto.randomUUID());
    const dryRun  = body.dryRun === true;

    // ── GATE 1: Load settings — safety check FIRST ────────────
    const settings = await loadQueueSettings(db);

    // Safety invariant: if not enabled or kill_switch active → return immediately
    if (!settings.external_discovery_enabled) {
      console.log(JSON.stringify({ event: 'gate_blocked', runId, propertyId, reason: 'external_discovery_enabled=false' }));
      return json({ success: true, blocked: true, reason: 'external_discovery_enabled=false', jobs_processed: 0 });
    }
    if (settings.provider_kill_switch) {
      console.log(JSON.stringify({ event: 'gate_blocked', runId, propertyId, reason: 'provider_kill_switch=true' }));
      return json({ success: true, blocked: true, reason: 'provider_kill_switch=true', jobs_processed: 0 });
    }

    const isDryRun = dryRun || settings.dry_run_mode;
    const maxJobs  = settings.max_jobs;

    // ── GATE 2: Property must be ACTIVE ───────────────────────
    const { data: prop } = await db.from('properties').select('id,matching_status').eq('id',propertyId).maybeSingle();
    if (!prop || prop.matching_status !== 'ACTIVE') {
      return json({ success: true, blocked: true, reason: `Property not ACTIVE`, jobs_processed: 0 });
    }

    // ── Claim jobs property-scoped (SKIP LOCKED RPC) ──────────
    const { data: claimed, error: claimErr } = await db.rpc('claim_discovery_jobs_scoped', {
      p_property_id: propertyId,
      p_run_id:      runId,
      p_max_jobs:    maxJobs,
    });
    if (claimErr) throw claimErr;

    const jobs: Record<string,unknown>[] = claimed ?? [];
    if (!jobs.length) {
      return json({ success: true, propertyId, runId, jobs_claimed: 0, jobs_processed: 0, dry_run: isDryRun });
    }

    console.log(JSON.stringify({ event: 'jobs_claimed', runId, propertyId, count: jobs.length, dry_run: isDryRun }));

    let completed = 0, failed = 0, retried = 0;
    let totalCandidates = 0, totalNewSignals = 0, totalCostUsd = 0;

    for (const job of jobs) {
      const jobId      = String(job['id']);
      const claimToken = String(job['claim_token'] ?? '');
      const platform   = String(job['platform'] ?? '');
      const query      = String(job['query'] ?? '');
      const language   = String(job['language'] ?? 'en');
      const attempt    = Number(job['attempts'] ?? 1);

      // ── Dry-run: simulate without real call ──────────────
      if (isDryRun) {
        const mockResult = { candidates: 3, newSignals: 2, costUsd: 0 };
        await db.rpc('complete_discovery_job', {
          p_job_id: jobId, p_claim_token: claimToken,
          p_success: true, p_result_count: mockResult.candidates, p_cost_usd: 0,
        });
        totalCandidates += mockResult.candidates;
        totalNewSignals += mockResult.newSignals;
        completed++;
        console.log(JSON.stringify({ event: 'dry_run_job_done', runId, jobId, platform, query: query.slice(0,60) }));
        continue;
      }

      try {
        let result: { candidates: number; newSignals: number; costUsd: number };

        if (WEB_PLATFORMS.has(platform)) {
          result = await processWebJob(base, key, propertyId, jobId, query, platform, language);
        } else if (ACTOR_PLATFORMS.has(platform)) {
          if (!apify) {
            await db.rpc('complete_discovery_job', {
              p_job_id: jobId, p_claim_token: claimToken,
              p_success: false, p_error_msg: 'APIFY_API_TOKEN not configured',
            });
            failed++;
            continue;
          }
          result = await processApifyJob(db, apify, propertyId, jobId, query, platform, language, attempt);
        } else {
          await db.rpc('complete_discovery_job', {
            p_job_id: jobId, p_claim_token: claimToken,
            p_success: false, p_error_msg: `Unsupported platform: ${platform}`,
          });
          failed++;
          continue;
        }

        const ok = await db.rpc('complete_discovery_job', {
          p_job_id: jobId, p_claim_token: claimToken,
          p_success: true, p_result_count: result.candidates, p_cost_usd: result.costUsd,
        });

        if (ok.data === false) {
          console.error(JSON.stringify({ event: 'complete_job_rejected', runId, jobId, reason: 'claim mismatch or not PROCESSING' }));
          failed++;
          continue;
        }

        totalCandidates += result.candidates;
        totalNewSignals += result.newSignals;
        totalCostUsd    += result.costUsd;
        completed++;

        console.log(JSON.stringify({
          event: 'job_done', runId, jobId, platform, candidates: result.candidates,
          new_signals: result.newSignals, cost_usd: result.costUsd,
        }));

      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const isTransient = /timeout|429|5[0-9][0-9]/.test(msg);
        await db.rpc('complete_discovery_job', {
          p_job_id: jobId, p_claim_token: claimToken,
          p_success: false, p_error_msg: msg.slice(0, 500),
        });
        isTransient ? retried++ : failed++;
        console.error(JSON.stringify({ event: 'job_error', runId, jobId, platform, error: msg, transient: isTransient }));
      }
    }

    return json({
      success: true, propertyId, runId, dry_run: isDryRun,
      jobs_claimed: jobs.length, jobs_completed: completed,
      jobs_failed: failed, jobs_retried: retried,
      candidates_linked: totalCandidates,
      new_raw_signals: totalNewSignals,
      cost_usd: totalCostUsd,
    });

  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// ── Web job via dataforseo-search EF ─────────────────────────────
async function processWebJob(
  base: string, key: string, propertyId: string, jobId: string,
  query: string, platform: string, language: string,
): Promise<{ candidates: number; newSignals: number; costUsd: number }> {
  const site = platform === 'VK' ? 'site:vk.com ' : platform === 'INSTAGRAM' ? 'site:instagram.com ' : '';
  const r = await fetch(`${base}/functions/v1/dataforseo-search`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ propertyId, queryId: jobId, queries: [`${site}${query}`], language, country: 'GE' }),
    signal:  AbortSignal.timeout(90_000),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`dataforseo-search ${r.status}: ${t.slice(0,300)}`);
  const d = JSON.parse(t) as Record<string,unknown>;
  return {
    candidates: Number(d['candidatesLinked'] ?? d['signalsInserted'] ?? 0),
    newSignals:  Number(d['signalsInserted'] ?? 0),
    costUsd:     Number(d['costUsd'] ?? 0),
  };
}

// ── Apify async job (fire-and-track) ─────────────────────────────
async function processApifyJob(
  db: ReturnType<typeof createClient>,
  token: string,
  propertyId: string, jobId: string, query: string, platform: string, language: string, attempt: number,
): Promise<{ candidates: number; newSignals: number; costUsd: number }> {
  const actor = ACTORS[platform];
  if (!actor) throw new Error(`No Apify actor for platform ${platform}`);

  const input = buildActorInput(platform, query, language);
  const runResp = await fetch(`https://api.apify.com/v2/acts/${actor}/runs?memory=1024&timeout=900`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(input),
    signal:  AbortSignal.timeout(20_000),
  });
  if (!runResp.ok) throw new Error(`Apify start ${runResp.status}: ${(await runResp.text()).slice(0,350)}`);
  const runData = ((await runResp.json()) as Record<string,unknown>)['data'] as Record<string,unknown> ?? {};
  const runId = String(runData['id'] ?? '');

  // Update job with run ID for later polling (requeue as PENDING won't happen here;
  // the RPC sets next_run_at so the next tick picks it up to poll)
  await db.from('discovery_query_queue').update({
    external_run_id: runId,
    dataset_id: (runData['defaultDatasetId'] as string) ?? null,
    provider: 'APIFY',
    actor_id: actor,
    metadata: { lastStatus: runData['status'] ?? 'READY', attempt },
  }).eq('id', jobId);

  // For async actors we don't wait inline — poll on next invocation
  // Return 0 candidates for now; polling will complete it
  return { candidates: 0, newSignals: 0, costUsd: 0 };
}

function buildActorInput(platform: string, query: string, language: string): Record<string,unknown> {
  const lang = language.toLowerCase();
  if (platform === 'FACEBOOK') return { keywords: [query], afterDate: 'last_month', maxPosts: 150, countryCode: 'ge' };
  if (platform === 'TELEGRAM') return { mode: 'keyword', keywords: [query], afterDate: '1 month', countryCode: 'ge', languageCode: lang, maxResultsPerKeyword: 150 };
  if (platform === 'THREADS')  return { mode: 'search', searchQueries: [query], maxPosts: 120, postedAfter: new Date(Date.now()-45*86400_000).toISOString() };
  if (platform === 'REDDIT')   return { queries: [query], sort: 'new', numberOfPosts: 120, timeFilter: 'month' };
  return { query };
}

// ── Signal text helpers ───────────────────────────────────────────
function signalText(x: Record<string,unknown>): string {
  return String(x['text']??x['message']??x['post_text']??x['content']??x['selftext']??x['body']??x['title']??x['caption']??x['description']??'').trim();
}

async function fingerprint(t: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t.toLowerCase().replace(/\s+/g,' ').trim().slice(0,1200)));
  return Array.from(new Uint8Array(buf)).map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,32);
}

function canonUrl(platform: string, raw: string): string {
  try {
    if (platform === 'FACEBOOK') { const m = new URL(raw).pathname.match(/\/groups\/([^/]+)/); return m ? `https://www.facebook.com/groups/${m[1]}/` : ''; }
    if (platform === 'TELEGRAM') { const parts = new URL(raw).pathname.split('/').filter(x=>x&&x!=='s'); return parts[0] ? `https://t.me/${parts[0]}` : ''; }
  } catch { return ''; }
  return raw;
}

// Ingest items from an Apify dataset result
async function ingestItems(
  db: ReturnType<typeof createClient>,
  propertyId: string, jobId: string, platform: string, language: string,
  items: Record<string,unknown>[], runCostUsd: number,
): Promise<{ candidates: number; newSignals: number; sources: number }> {
  const usable = items.filter(x => signalText(x).length >= 20);
  const share  = usable.length ? runCostUsd / usable.length : 0;
  let candidates = 0, newSignals = 0, sources = 0;

  for (const x of usable) {
    const text   = signalText(x);
    const fp     = await fingerprint(text);
    const srcUrl = String(x['group_url']??x['channelUrl']??x['channel_url']??x['sourceUrl']??x['source_url']??'');
    const canonSrc = canonUrl(platform, srcUrl);

    // Ensure source exists
    let sourceId: string | null = null;
    if (canonSrc) {
      const { data: existSrc } = await db.from('source_registry').select('id').eq('url', canonSrc).maybeSingle();
      if (existSrc?.id) {
        sourceId = existSrc.id;
      } else {
        const srcType = platform === 'FACEBOOK' ? 'FACEBOOK_GROUP' : platform === 'TELEGRAM' ? 'TELEGRAM_GROUP' : platform === 'REDDIT' ? 'FORUM' : 'WEBSITE';
        const { data: newSrc } = await db.from('source_registry').insert({
          platform: dbPlatform(platform), source_type: srcType, url: canonSrc,
          external_id: canonSrc, name: String(x['group_name']??x['channelTitle']??x['channel_title']??canonSrc).slice(0,240),
          country_code: 'GE', language, active: true, priority: 75, quality_score: 6, provider: 'APIFY',
        }).select('id').single();
        if (newSrc) { sourceId = newSrc.id; sources++; }
      }
    }
    if (!sourceId) {
      const ext = `QUEUE_${platform}_${language}`;
      const { data: synth } = await db.from('source_registry').select('id').eq('external_id', ext).maybeSingle();
      if (synth?.id) { sourceId = synth.id; }
      else {
        const { data: newSynth } = await db.from('source_registry').insert({
          platform: dbPlatform(platform), source_type: 'WEBSITE', external_id: ext,
          name: `${platform} queue discovery`, url: `https://homatch.live/source/${ext.toLowerCase()}`,
          country_code: 'GE', language, active: true, priority: 50, quality_score: 4, provider: 'APIFY',
        }).select('id').single();
        if (newSynth) sourceId = newSynth.id;
      }
    }

    // Dedup: externalId + canonical URL + fingerprint
    const extId = String(x['id']??x['message_id']??x['messageId']??x['postId']??x['facebookId']??x['post_url']??fp);
    const dbPlat = dbPlatform(platform);

    const { data: existing } = await db.from('raw_signals').select('id')
      .eq('platform', dbPlat).eq('external_id', extId).maybeSingle();

    let signalId: string;
    if (existing?.id) {
      signalId = existing.id;
      await db.from('raw_signals').update({
        last_seen_at: new Date().toISOString(),
        ...(sourceId ? { source_id: sourceId } : {}),
      }).eq('id', signalId);
    } else {
      const { data: created, error: insErr } = await db.from('raw_signals').insert({
        source_id: sourceId, platform: dbPlat, external_id: extId,
        source_url:          String(x['post_url']??x['messageUrl']??x['message_url']??x['url']??'') || null,
        author_public_name:  String(x['author_name']??x['author']??x['username']??x['ownerName']??'') || null,
        author_public_url:   String(x['author_url']??x['authorUrl']??x['channelUrl']??'') || null,
        original_text: text, language,
        published_at: normalizeDate(x['date']??x['published_at']??x['publishedAt']??x['created_at']??x['timestamp']),
        content_fingerprint: fp,
        provider: 'APIFY',
        classification_status: 'PENDING',
        mock_mode: false,
      }).select('id').single();

      if (insErr) {
        // Race condition — try fetching
        const { data: race } = await db.from('raw_signals').select('id').eq('platform', dbPlat).eq('external_id', extId).maybeSingle();
        if (!race?.id) continue;
        signalId = race.id;
      } else {
        signalId = created!.id;
        newSignals++;
      }
    }

    // Link candidate to property (upsert — dedup by property+signal)
    const { error: linkErr } = await db.from('property_signal_candidates').upsert({
      property_id: propertyId, signal_id: signalId, query_id: jobId,
      acquisition_cost_usd: share, last_seen_at: new Date().toISOString(),
      metadata: { platform, language, job_id: jobId },
    }, { onConflict: 'property_id,signal_id', ignoreDuplicates: false });

    if (!linkErr) candidates++;
  }
  return { candidates, newSignals, sources };
}

function dbPlatform(p: string): string {
  if (p === 'REDDIT') return 'FORUM';
  if (p === 'THREADS') return 'OTHER';
  return p;
}

function normalizeDate(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'number') return new Date(v > 1e12 ? v : v * 1000).toISOString();
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d.toISOString();
}
const APIFY='https://api.apify.com/v2';
const ACTORS:Record<string,string>={
  FACEBOOK:'lofomachines~facebook-groups-posts-search-scraper',
  TELEGRAM:'lofomachines~telegram-keyword-search-scraper',
  REDDIT:'outspoken_strategy~reddit-posts-search-scraper',
  THREADS:'webdata_labs~threads-scraper',
};
const TERMINAL=new Set(['SUCCEEDED','FAILED','ABORTED','TIMED-OUT']);
const LANGS=['en','ru','ka','tr','ar','he'];
const ACTOR_PLATFORMS=['FACEBOOK','TELEGRAM','REDDIT','THREADS'];
const WEB_PLATFORMS=['WEB','VK','INSTAGRAM'];

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:CORS});
  const base=Deno.env.get('SUPABASE_URL')!;
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const apify=Deno.env.get('APIFY_API_TOKEN')||'';
  const db=createClient(base,key);
  try{
    if((req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'')!==key)return json({error:'Internal only'},403);
    const body=await req.json().catch(()=>({}));
    const propertyId=String(body.propertyId||'');
    if(!propertyId)return json({error:'propertyId required'},400);
    const batch=Math.max(1,Math.min(28,Number(body.batchSize)||14));
    const now=new Date().toISOString();
    let polled=0,completed=0,retried=0,failed=0,launched=0,webDone=0,candidates=0,newSignals=0,sources=0,costUsd=0;

    const {data:running,error:runErr}=await db.from('discovery_query_queue').select('*')
      .eq('property_id',propertyId).eq('status','PROCESSING')
      .or(`next_attempt_at.is.null,next_attempt_at.lte.${now}`)
      .order('started_at',{ascending:true}).limit(batch);
    if(runErr)throw runErr;

    for(const q of running||[]){
      polled++;
      try{
        const run=await getRun(apify,q.external_run_id);
        const status=String(run.status||'');
        if(!TERMINAL.has(status)){
          await db.from('discovery_query_queue').update({
            next_attempt_at:new Date(Date.now()+120000).toISOString(),
            metadata:{...(q.metadata||{}),lastStatus:status}
          }).eq('id',q.id);
          continue;
        }
        if(status!=='SUCCEEDED'){
          await retry(db,q,`Apify ${status}`,false);
          retried++;
          continue;
        }
        const dataset=run.defaultDatasetId||q.dataset_id;
        if(!dataset)throw new Error('Apify run succeeded without dataset');
        const items=await getDataset(apify,dataset);
        const runCost=Number(run.usageTotalUsd||run.usage?.totalUsd||0);
        const saved=await ingestItems(db,q,items,runCost);
        candidates+=saved.candidates;newSignals+=saved.newSignals;sources+=saved.sources;costUsd+=runCost;
        await db.from('discovery_query_queue').update({
          status:'DONE',dataset_id:dataset,result_count:saved.candidates,processed_at:new Date().toISOString(),
          next_attempt_at:null,last_error:null,
          metadata:{...(q.metadata||{}),lastStatus:status,itemCount:items.length,candidateCount:saved.candidates,newSignalCount:saved.newSignals,sourceCount:saved.sources,usageTotalUsd:runCost}
        }).eq('id',q.id);
        await db.from('cost_events').insert({provider:'APIFY',operation_type:`QUEUE_${q.platform}`,source:String(q.query).slice(0,180),market:'GE',units:items.length,cost_usd:runCost,success:true,cache_hit:false,property_id:propertyId});
        completed++;
      }catch(e){
        await retry(db,q,e instanceof Error?e.message:String(e),false);
        retried++;
      }
    }

    const apifySpend=await monthlySpend(db,'APIFY');
    const apifyCap=await cap(db,'spend_cap_apify',100);
    const canLaunch=!!apify&&apifySpend<apifyCap;
    const {count:processingCount}=await db.from('discovery_query_queue').select('id',{count:'exact',head:true}).eq('status','PROCESSING').eq('provider','APIFY');
    const apifySlots=Math.max(0,4-Number(processingCount||0));

    const {data:pending,error:pendingErr}=await db.from('discovery_query_queue').select('*')
      .eq('property_id',propertyId).eq('status','PENDING')
      .or(`next_attempt_at.is.null,next_attempt_at.lte.${now}`)
      .order('priority',{ascending:false}).order('created_at',{ascending:true}).limit(1200);
    if(pendingErr)throw pendingErr;
    const chosen=balanced(pending||[],batch);
    let actorLaunches=0,webLaunches=0;
    for(const q of chosen){
      try{
        if(WEB_PLATFORMS.includes(q.platform)){
          if(webLaunches>=3)continue;
          const result=await webSearch(base,key,propertyId,q.id,q.query,q.platform,q.language);
          await db.from('discovery_query_queue').update({
            status:'DONE',attempts:Number(q.attempts||0)+1,result_count:result.candidates,provider:'DATAFORSEO',
            processed_at:new Date().toISOString(),last_error:null,next_attempt_at:null,
            metadata:{...(q.metadata||{}),candidateCount:result.candidates,newSignalCount:result.newSignals,costUsd:result.costUsd}
          }).eq('id',q.id);
          candidates+=result.candidates;newSignals+=result.newSignals;costUsd+=result.costUsd;webDone++;webLaunches++;
          continue;
        }
        const actor=ACTORS[q.platform];
        if(!actor)throw new Error(`No provider for ${q.platform}`);
        if(!canLaunch||actorLaunches>=apifySlots)continue;
        const input=actorInput(q);
        const run=await startRun(apify,actor,input);
        await db.from('discovery_query_queue').update({
          status:'PROCESSING',attempts:Number(q.attempts||0)+1,provider:'APIFY',actor_id:actor,
          external_run_id:run.id,dataset_id:run.defaultDatasetId||null,started_at:new Date().toISOString(),
          next_attempt_at:new Date(Date.now()+60000).toISOString(),last_error:null,
          metadata:{...(q.metadata||{}),inputSummary:input,lastStatus:run.status||'READY'}
        }).eq('id',q.id);
        launched++;actorLaunches++;
      }catch(e){
        await retry(db,q,e instanceof Error?e.message:String(e),true);
        if(Number(q.attempts||0)+1>=3)failed++;else retried++;
      }
    }

    return json({success:true,propertyId,polled,completed,retried,failed,launched,webDone,candidatesLinked:candidates,newRawSignals:newSignals,sourcesInserted:sources,apifySpendUsd:apifySpend,apifyCapUsd:apifyCap,apifyProcessing:Number(processingCount||0),apifySlots,costUsd});
  }catch(e){return json({error:e instanceof Error?e.message:String(e)},500)}
});

function balanced(rows:any[],limit:number){
  const buckets=new Map<string,any[]>();
  for(const row of rows){const key=`${row.platform}:${row.language||'any'}`;const a=buckets.get(key)||[];a.push(row);buckets.set(key,a)}
  const order:string[]=[];
  for(const l of LANGS)for(const p of [...ACTOR_PLATFORMS,...WEB_PLATFORMS])order.push(`${p}:${l}`);
  const out:any[]=[];
  while(out.length<limit){let added=false;for(const k of order){const a=buckets.get(k)||[];if(a.length&&out.length<limit){out.push(a.shift());added=true}}if(!added)break}
  return out;
}

function actorInput(q:any){
  const query=String(q.query),lang=String(q.language||'en').toLowerCase();
  if(q.platform==='FACEBOOK')return{keywords:[query],afterDate:'last_month',maxPosts:150,countryCode:'ge'};
  if(q.platform==='TELEGRAM')return{mode:'keyword',keywords:[query],afterDate:'1 month',countryCode:'ge',languageCode:lang,maxResultsPerKeyword:150};
  if(q.platform==='THREADS')return{mode:'search',searchQueries:[query],maxPosts:120,postedAfter:new Date(Date.now()-45*86400000).toISOString()};
  if(q.platform==='REDDIT')return{queries:[query],sort:'new',numberOfPosts:120,timeFilter:'month'};
  return{query};
}

async function startRun(token:string,actor:string,input:any){
  const r=await fetch(`${APIFY}/acts/${actor}/runs?memory=1024&timeout=900`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(20000)});
  const t=await r.text();if(!r.ok)throw new Error(`${actor} start ${r.status}: ${t.slice(0,350)}`);const d=JSON.parse(t);return d.data||d;
}
async function getRun(token:string,id:string){
  if(!id)throw new Error('Missing external run id');
  const r=await fetch(`${APIFY}/actor-runs/${id}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
  const t=await r.text();if(!r.ok)throw new Error(`run ${r.status}: ${t.slice(0,250)}`);const d=JSON.parse(t);return d.data||d;
}
async function getDataset(token:string,id:string){
  const r=await fetch(`${APIFY}/datasets/${id}/items?clean=true&format=json&limit=3000`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw new Error(`dataset ${r.status}: ${(await r.text()).slice(0,250)}`);const d=await r.json();return Array.isArray(d)?d:[];
}

async function webSearch(base:string,key:string,propertyId:string,queryId:string,query:string,platform:string,language:string){
  const site=platform==='VK'?'site:vk.com ':platform==='INSTAGRAM'?'site:instagram.com ':'';
  const r=await fetch(`${base}/functions/v1/dataforseo-search`,{method:'POST',headers:{Authorization:`Bearer ${key}`,apikey:key,'Content-Type':'application/json'},body:JSON.stringify({propertyId,queryId,queries:[`${site}${query}`],language:language||'en',country:'GE'}),signal:AbortSignal.timeout(90000)});
  const t=await r.text();if(!r.ok)throw new Error(`web ${r.status}: ${t.slice(0,300)}`);const d=JSON.parse(t);
  return{candidates:Number(d.candidatesLinked||d.signalsInserted||0),newSignals:Number(d.signalsInserted||0),costUsd:Number(d.costUsd||0)};
}

async function ingestItems(db:any,q:any,items:any[],runCost:number){
  const usable=items.filter((x:any)=>signalText(x).length>=20);
  const share=usable.length?runCost/usable.length:0;
  let candidates=0,newSignals=0,sources=0;
  for(const x of usable){
    const text=signalText(x);
    const info=sourceInfo(q.platform,x);
    let sourceId:string|null=null;
    if(info.url){const s=await ensureSource(db,info.platform,info.type,info.url,info.name,info.externalId,q.language);sourceId=s.id;if(s.created)sources++;}
    else sourceId=(await ensureSynthetic(db,q.platform,q.language)).id;
    const sourceUrl=x.post_url||x.postUrl||x.messageUrl||x.message_url||x.source_url||x.permalink||x.url||null;
    const rawExternal=String(x.id||x.message_id||x.messageId||x.postId||x.facebookId||sourceUrl||await fp(text));
    const platform=dbPlatform(q.platform);
    let {data:signal}=await db.from('raw_signals').select('id,classification_status').eq('platform',platform).eq('external_id',rawExternal).maybeSingle();
    if(!signal){
      const {data:created,error}=await db.from('raw_signals').insert({
        source_id:sourceId,platform,external_id:rawExternal,source_url:sourceUrl,
        author_public_name:x.author_name||x.author||x.username||x.source_name||x.ownerName||x.user?.name||null,
        author_public_url:x.author_url||x.authorUrl||x.channelUrl||x.authorProfileUrl||x.ownerUrl||x.user?.profileUrl||null,
        original_text:text,language:q.language||null,
        published_at:date(x.date||x.published_at||x.publishedAt||x.created_at||x.createdAt||x.createdUtc||x.created_utc||x.timestamp||x.time),
        content_fingerprint:await fp(`${platform}:${rawExternal}:${text}`),provider:'APIFY',classification_status:'PENDING',mock_mode:false
      }).select('id,classification_status').single();
      if(error){const {data:race}=await db.from('raw_signals').select('id,classification_status').eq('platform',platform).eq('external_id',rawExternal).maybeSingle();if(!race)continue;signal=race;}else{signal=created;newSignals++;}
    }else{
      await db.from('raw_signals').update({last_seen_at:new Date().toISOString(),source_id:sourceId||undefined,source_url:sourceUrl||undefined}).eq('id',signal.id);
    }
    if(await linkCandidate(db,q.property_id,signal.id,q.id,share,{platform:q.platform,language:q.language,query:q.query}))candidates++;
  }
  return{candidates,newSignals,sources};
}

async function linkCandidate(db:any,propertyId:string,signalId:string,queryId:string,cost:number,metadata:any){
  const {data:old}=await db.from('property_signal_candidates').select('id,acquisition_cost_usd').eq('property_id',propertyId).eq('signal_id',signalId).maybeSingle();
  if(old?.id){await db.from('property_signal_candidates').update({last_seen_at:new Date().toISOString(),acquisition_cost_usd:Number(old.acquisition_cost_usd||0)+Number(cost||0),metadata}).eq('id',old.id);return true;}
  const {error}=await db.from('property_signal_candidates').insert({property_id:propertyId,signal_id:signalId,query_id:queryId,acquisition_cost_usd:Number(cost||0),metadata});
  if(!error)return true;
  const {data:race}=await db.from('property_signal_candidates').select('id').eq('property_id',propertyId).eq('signal_id',signalId).maybeSingle();return !!race?.id;
}

function signalText(x:any){return String(x.text||x.message||x.post_text||x.content||x.selftext||x.body||x.title||x.caption||x.description||'').trim();}
function sourceInfo(platform:string,x:any){
  if(platform==='FACEBOOK'){const u=canonFb(x.group_url||x.groupUrl||x.inputUrl||x.facebookUrl||'');return{platform:'FACEBOOK',type:'FACEBOOK_GROUP',url:u,name:x.group_name||x.groupName||u,externalId:x.group_id||u};}
  if(platform==='TELEGRAM'){const u=canonTg(x.channelUrl||x.channel_url||x.source_url||x.sourceUrl||'');return{platform:'TELEGRAM',type:'TELEGRAM_GROUP',url:u,name:x.channelTitle||x.channel_title||x.source_name||u,externalId:x.source_id||u};}
  if(platform==='REDDIT'){const raw=x.subredditUrl||x.permalink||x.url||'';let u='';try{const m=new URL(raw.startsWith('http')?raw:`https://reddit.com${raw}`).pathname.match(/\/r\/([^/]+)/);if(m)u=`https://www.reddit.com/r/${m[1]}/`;}catch{}return{platform:'FORUM',type:'FORUM',url:u,name:x.subreddit?`r/${x.subreddit}`:u,externalId:x.subreddit||u};}
  if(platform==='THREADS'){const raw=x.profileUrl||x.authorUrl||x.url||'';let u='';try{const z=new URL(raw);const first=z.pathname.split('/').filter(Boolean)[0];if(first)u=`https://www.threads.net/@${first.replace(/^@/,'')}`;}catch{}return{platform:'OTHER',type:'WEBSITE',url:u,name:x.username||x.author||u,externalId:u};}
  return{platform:dbPlatform(platform),type:'WEBSITE',url:'',name:'',externalId:''};
}
async function ensureSource(db:any,platform:string,type:string,url:string,name:string,externalId:any,language:string){
  const {data:e}=await db.from('source_registry').select('id').eq('url',url).maybeSingle();if(e?.id)return{id:e.id,created:false};
  const {data:n,error}=await db.from('source_registry').insert({platform,source_type:type,url,external_id:String(externalId||url),name:String(name||url).slice(0,240),country_code:'GE',language:language||null,active:true,priority:75,quality_score:6,provider:'APIFY'}).select('id').single();
  if(error){const {data:r}=await db.from('source_registry').select('id').eq('url',url).maybeSingle();if(r?.id)return{id:r.id,created:false};throw error;}return{id:n.id,created:true};
}
async function ensureSynthetic(db:any,platform:string,language:string){
  const ext=`QUEUE_${platform}_${language||'any'}`;const {data:e}=await db.from('source_registry').select('id').eq('external_id',ext).maybeSingle();if(e?.id)return{id:e.id};
  const p=dbPlatform(platform),type=platform==='FACEBOOK'?'FACEBOOK_GROUP':platform==='TELEGRAM'?'TELEGRAM_GROUP':platform==='REDDIT'?'FORUM':'WEBSITE';
  const {data:n,error}=await db.from('source_registry').insert({platform:p,source_type:type,external_id:ext,name:`${platform} queue discovery`,url:`https://homatch.live/source/${ext.toLowerCase()}`,country_code:'GE',language:language||null,active:true,priority:50,quality_score:4,provider:'APIFY'}).select('id').single();if(error)throw error;return{id:n.id};
}
async function retry(db:any,q:any,msg:string,increment:boolean){
  const attempts=Number(q.attempts||0)+(increment?1:0);
  if(attempts>=3)await db.from('discovery_query_queue').update({status:'FAILED',attempts,last_error:msg.slice(0,500),processed_at:new Date().toISOString(),next_attempt_at:null,external_run_id:null,dataset_id:null,started_at:null}).eq('id',q.id);
  else await db.from('discovery_query_queue').update({status:'PENDING',attempts,last_error:msg.slice(0,500),external_run_id:null,dataset_id:null,started_at:null,next_attempt_at:new Date(Date.now()+10*60000).toISOString()}).eq('id',q.id);
}
async function monthlySpend(db:any,provider:string){const start=new Date();start.setUTCDate(1);start.setUTCHours(0,0,0,0);const {data}=await db.from('cost_events').select('cost_usd').eq('provider',provider).gte('timestamp',start.toISOString());return(data||[]).reduce((n:number,x:any)=>n+Number(x.cost_usd||0),0);}
async function cap(db:any,k:string,fallback:number){const {data}=await db.from('admin_settings').select('value').eq('key',k).maybeSingle();const n=Number(typeof data?.value==='string'?String(data.value).replace(/"/g,''):data?.value);return Number.isFinite(n)?n:fallback;}
function dbPlatform(p:string){return p==='REDDIT'?'FORUM':p==='THREADS'?'OTHER':p;}
function canonFb(v:string){try{const z=new URL(v);const m=z.pathname.match(/\/groups\/([^/]+)/);return m?`https://www.facebook.com/groups/${m[1]}/`:'';}catch{return'';}}
function canonTg(v:string){try{const z=new URL(v);const parts=z.pathname.split('/').filter(Boolean).filter(x=>x!=='s');return parts[0]?`https://t.me/${parts[0]}`:'';}catch{return'';}}
function date(v:any){if(!v)return null;if(typeof v==='number')return new Date(v>1e12?v:v*1000).toISOString();const d=new Date(v);return isNaN(d.getTime())?null:d.toISOString();}
async function fp(t:string){const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(t.toLowerCase().replace(/\s+/g,' ').trim().slice(0,1200)));return Array.from(new Uint8Array(h)).map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,32);}
