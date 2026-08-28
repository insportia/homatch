#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
/**
 * HOMATCH Worker Scheduler
 *
 * Runs all background jobs on a schedule.
 * Fully portable — no Supabase cron dependency.
 * Deploy on any VPS alongside docker-compose.yml.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  discoverMarketSources,
  collectSourceUpdates,
  classifyCandidateSignals,
  runMatching,
  sendNotifications,
  aggregateProviderCosts,
  cleanupExpiredData,
} from './_shared/jobs.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? Deno.env.get('DATABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

const ctx = { supabase };

function log(job: string, result: any) {
  const icon = result.success ? '✓' : '✗';
  console.log(`[scheduler] ${icon} ${job} — processed: ${result.processed}, errors: ${result.errors.length}, ${result.duration_ms}ms`);
  if (result.errors.length > 0) console.error(`  errors:`, result.errors);
  if (result.skipped_cap > 0) console.warn(`  [cap] ${result.skipped_cap} skipped due to spend caps`);
}

// Schedule intervals
const INTERVALS = {
  discover:    6 * 60 * 60 * 1000,  // every 6 hours
  collect:     30 * 60 * 1000,       // every 30 minutes
  classify:    15 * 60 * 1000,       // every 15 minutes
  match:       20 * 60 * 1000,       // every 20 minutes
  notify:      5 * 60 * 1000,        // every 5 minutes
  aggregate:   60 * 60 * 1000,       // every hour
  cleanup:     24 * 60 * 60 * 1000,  // every 24 hours
};

async function run(name: string, fn: () => Promise<any>) {
  try {
    const result = await fn();
    log(name, result);
  } catch (e: any) {
    console.error(`[scheduler] FATAL ${name}:`, e.message);
  }
}

// Initial run on start
await run('discoverMarketSources',    () => discoverMarketSources(ctx));
await run('collectSourceUpdates',     () => collectSourceUpdates(ctx));
await run('classifyCandidateSignals', () => classifyCandidateSignals(ctx));
await run('runMatching',              () => runMatching(ctx));
await run('sendNotifications',        () => sendNotifications(ctx));

// Recurring schedules
setInterval(() => run('discoverMarketSources',    () => discoverMarketSources(ctx)),    INTERVALS.discover);
setInterval(() => run('collectSourceUpdates',     () => collectSourceUpdates(ctx)),     INTERVALS.collect);
setInterval(() => run('classifyCandidateSignals', () => classifyCandidateSignals(ctx)), INTERVALS.classify);
setInterval(() => run('runMatching',              () => runMatching(ctx)),              INTERVALS.match);
setInterval(() => run('sendNotifications',        () => sendNotifications(ctx)),        INTERVALS.notify);
setInterval(() => run('aggregateProviderCosts',   () => aggregateProviderCosts(ctx)),   INTERVALS.aggregate);
setInterval(() => run('cleanupExpiredData',       () => cleanupExpiredData(ctx)),       INTERVALS.cleanup);

console.log('[scheduler] Homatch worker started. All jobs scheduled.');
