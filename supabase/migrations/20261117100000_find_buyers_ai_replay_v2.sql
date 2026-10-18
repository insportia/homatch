-- FIND BUYERS — AI replay of campaign 343cfc41 with classifier fb-ai-2 (owner, 2026-10-18).
-- The fb-ai-1 replay finished, and showed rental listings read as tenants and "Куплю USDT" read
-- as a property buyer; fb-ai-2 adds a deterministic consistency gate. This keeps the fb-ai-1
-- result under its own key (history preserved) and asks the worker for a fresh replay of the
-- same STORED candidates: no Actor run, no lead write, no customer charge — its model calls are
-- recorded in find_buyers_cost_ledger as AI_REPLAY with no matching job.

insert into public.admin_settings (key, value, updated_at)
select 'find_buyers_ai_replay_result_fb-ai-1', value, now()
from public.admin_settings
where key = 'find_buyers_ai_replay_result' and value->>'version' = 'fb-ai-1'
on conflict (key) do nothing;

update public.admin_settings
set value = jsonb_build_object(
      'matchingJobId', '343cfc41-0b03-43c1-9499-c3615dc2ac2d',
      'status', 'REQUESTED',
      'version', 'fb-ai-2',
      'requestedAt', now(),
      'reason', 'fb-ai-2 consistency gate: listings and non-property purchases are never demand'),
    updated_at = now()
where key = 'find_buyers_ai_replay_request'
  and value->>'status' in ('DONE', 'FAILED');
