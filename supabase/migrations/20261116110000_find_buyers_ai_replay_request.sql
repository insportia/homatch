-- Find Buyers AI-first classification (v11, owner 2026-10-18): replay the STORED candidates of
-- campaign 343cfc41 — whose two displayed leads were brokers — through the new classifier.
-- The discovery-queue-worker reads this request and advances it one page per quiet tick
-- (_shared/findBuyers/aiReplay.ts): no Actor run, no lead or assessment written, no customer
-- charge; its model calls are an internal QA cost (find_buyers_cost_ledger, no matching job).
-- The before/after table lands in admin_settings.find_buyers_ai_replay_result.
-- Data only: one request row, inserted once.
insert into public.admin_settings (key, value)
values ('find_buyers_ai_replay_request',
        '{"matchingJobId": "343cfc41-0b03-43c1-9499-c3615dc2ac2d", "status": "REQUESTED", "reason": "two displayed leads were brokers"}'::jsonb)
on conflict (key) do nothing;
