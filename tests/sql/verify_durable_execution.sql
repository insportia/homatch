-- verify_durable_execution — behaviour checks for the Verify task queue.
-- Run against a scratch database that has the migration applied
-- (see tests/sql/verify_durable_execution_fixture.sql and
-- scripts/verify-scale/README.md). Every check raises on failure.

\set ON_ERROR_STOP 1

do $$
declare
  j1 uuid; j2 uuid; j3 uuid;
  t jsonb; t2 jsonb; c jsonb; r jsonb; n integer; s text; tok bigint; tid uuid;
begin
  insert into public.research_jobs default values returning id into j1;
  insert into public.research_jobs default values returning id into j2;
  insert into public.research_jobs default values returning id into j3;

  -- 1. Idempotent enqueue: the same (job, dedupe_key) is one task.
  t  := public.verify_task_enqueue(j1, 'mygov', 'mygov:U1', 'mygov:U1', '{"cadastral":"U1"}');
  t2 := public.verify_task_enqueue(j1, 'mygov', 'mygov:U1', 'mygov:U1', '{"cadastral":"U1"}');
  if (t->>'id') <> (t2->>'id') or (t2->>'created')::boolean then raise exception '1: enqueue not idempotent'; end if;

  -- 2. Single-flight: another job asking for the same scope follows the producer.
  t2 := public.verify_task_enqueue(j2, 'mygov', 'mygov:U1', 'mygov:U1', '{"cadastral":"U1"}');
  if t2->>'state' <> 'WAITING_SHARED' or t2->>'sharedTaskId' <> t->>'id' then raise exception '2: no single-flight: %', t2; end if;

  -- 3. Claim gives a lease and a fencing token; a second claim gets nothing.
  select x into c from public.verify_task_claim('w1', array['HTTP'], 5) x limit 1;
  if c is null or c->>'id' <> t->>'id' or (c->>'fencingToken')::bigint <> 1 then raise exception '3: claim failed: %', c; end if;
  select count(*) into n from public.verify_task_claim('w2', array['HTTP'], 5);
  if n <> 0 then raise exception '3: double claim'; end if;
  tok := (c->>'fencingToken')::bigint; tid := (c->>'id')::uuid;

  -- 4. Fencing: a stale token cannot heartbeat or complete.
  s := public.verify_task_heartbeat(tid, tok + 7);
  if s <> 'LOST' then raise exception '4: stale heartbeat accepted'; end if;
  r := public.verify_task_complete(tid, tok + 7, '{"x":1}');
  if (r->>'ok')::boolean then raise exception '4: stale complete accepted'; end if;
  s := public.verify_task_heartbeat(tid, tok);
  if s <> 'OK' then raise exception '4: heartbeat failed: %', s; end if;

  -- 5. Complete: result cached; the follower receives it in the same transaction.
  r := public.verify_task_complete(tid, tok, '{"owner":"X"}', '[{"path":"sha/a"}]', 'h1');
  if not (r->>'ok')::boolean then raise exception '5: complete failed'; end if;
  select state into s from public.verify_tasks where id = (t2->>'id')::uuid;
  if s <> 'SUCCEEDED' then raise exception '5: follower not settled: %', s; end if;
  if not exists (select 1 from public.verify_evidence_cache where scope_key = 'mygov:U1' and fresh_until > now()) then raise exception '5: no cache'; end if;

  -- 6. Fresh cache: a third job is born SUCCEEDED without any work.
  t := public.verify_task_enqueue(j3, 'mygov', 'mygov:U1', 'mygov:U1', '{}');
  if t->>'state' <> 'SUCCEEDED' or t->>'reused' <> 'CACHE' then raise exception '6: cache not used: %', t; end if;

  -- 7. Retry with backoff, then dead-letter after max_attempts (tas: 3).
  t := public.verify_task_enqueue(j1, 'tas', 'tas:P1', 'tas:P1', '{}');
  for i in 1..3 loop
    update public.verify_tasks set run_after = now() where id = (t->>'id')::uuid and state = 'QUEUED';
    select x into c from public.verify_task_claim('w1', array['HTTP'], 1) x limit 1;
    if c is null then raise exception '7: claim % failed', i; end if;
    r := public.verify_task_fail((c->>'id')::uuid, (c->>'fencingToken')::bigint, 'TIMEOUT', true);
  end loop;
  select state into s from public.verify_tasks where id = (t->>'id')::uuid;
  if s <> 'DEAD' then raise exception '7: expected DEAD, got %', s; end if;
  if (select run_after from public.verify_tasks where id = (t->>'id')::uuid) <= now() then raise exception '7: no backoff'; end if;

  -- 8. Expired lease recovery: a crashed worker's task returns to the queue.
  t := public.verify_task_enqueue(j1, 'enreg', 'enreg:C1', 'enreg:C1', '{}');
  select x into c from public.verify_task_claim('crashed', array['BROWSER'], 1) x limit 1;
  update public.verify_tasks set lease_expires_at = now() - interval '1 second' where id = (c->>'id')::uuid;
  n := public.verify_task_recover_expired(10);
  select state into s from public.verify_tasks where id = (c->>'id')::uuid;
  if n <> 1 or s <> 'QUEUED' then raise exception '8: lease not recovered (% %)', n, s; end if;
  -- the crashed holder can no longer complete
  r := public.verify_task_complete((c->>'id')::uuid, (c->>'fencingToken')::bigint, '{}');
  if (r->>'ok')::boolean then raise exception '8: crashed holder completed after recovery'; end if;

  -- 9. Release (graceful shutdown) does not spend an attempt.
  update public.verify_tasks set run_after = now() where id = (c->>'id')::uuid;
  select x into c from public.verify_task_claim('w1', array['BROWSER'], 1) x limit 1;
  n := (select attempts from public.verify_tasks where id = (c->>'id')::uuid);
  perform public.verify_task_release((c->>'id')::uuid, (c->>'fencingToken')::bigint);
  if (select attempts from public.verify_tasks where id = (c->>'id')::uuid) <> n - 1 then raise exception '9: release spent an attempt'; end if;

  -- 10. Delegate: a flat with no own TAS cases resolves to the shared parcel.
  t  := public.verify_task_enqueue(j2, 'tas', 'tas:U2', 'tas:U2', '{}');
  t2 := public.verify_task_enqueue(j3, 'tas', 'tas:U3', 'tas:U3', '{}');
  perform public.verify_task_claim('w1', array['HTTP'], 5);  -- both flats are now RUNNING
  select public.verify_task_json(x) into c from public.verify_tasks x where id = (t->>'id')::uuid and state = 'RUNNING';
  if c is null then raise exception '10: first flat not claimed'; end if;
  r := public.verify_task_delegate((c->>'id')::uuid, (c->>'fencingToken')::bigint, 'tas:parcel:P9');
  if r->>'outcome' <> 'PRODUCE' then raise exception '10: first delegate should produce: %', r; end if;
  -- the second flat claims while the first still holds the parcel scope: it follows
  select public.verify_task_json(x) into c from public.verify_tasks x where id = (t2->>'id')::uuid and state = 'RUNNING';
  if c is null then raise exception '10: second flat not claimed'; end if;
  r := public.verify_task_delegate((c->>'id')::uuid, (c->>'fencingToken')::bigint, 'tas:parcel:P9');
  if r->>'outcome' <> 'SHARED' then raise exception '10: second delegate should share: %', r; end if;
  -- the producer completes under the parcel scope; the follower gets the same result
  select fencing_token into tok from public.verify_tasks where id = (t->>'id')::uuid;
  r := public.verify_task_complete((t->>'id')::uuid, tok, '{"cases":19}', '[]', null, 'tas:parcel:P9');
  if (select result->>'cases' from public.verify_tasks where id = (t2->>'id')::uuid) is distinct from '19' then
    raise exception '10: follower did not receive the parcel result';
  end if;

  -- 11. Cancel: queued work stops; a producer another job waits on keeps running.
  t  := public.verify_task_enqueue(j1, 'debtor', 'debtor:C7', 'debtor:C7', '{}');
  t2 := public.verify_task_enqueue(j2, 'debtor', 'debtor:C7', 'debtor:C7', '{}');
  n := public.verify_job_cancel_tasks(j1);
  select state into s from public.verify_tasks where id = (t->>'id')::uuid;
  if s <> 'QUEUED' then raise exception '11: shared producer was cancelled: %', s; end if;
  t := public.verify_task_enqueue(j3, 'rstax', 'rstax:C8', 'rstax:C8', '{}');
  n := public.verify_job_cancel_tasks(j3);
  if (select state from public.verify_tasks where id = (t->>'id')::uuid) <> 'CANCELLED' then raise exception '11: queued task not cancelled'; end if;
  -- 11b. Cancelling one task of a job leaves its other tasks alone, and frees the scope.
  t  := public.verify_task_enqueue(j3, 'enreg', 'enreg:C9', 'enreg:C9', '{}');
  t2 := public.verify_task_enqueue(j3, 'debtor', 'debtor:C9', 'debtor:C9', '{}');
  n := public.verify_job_cancel_tasks(j3, (t->>'id')::uuid);
  if n <> 1 or (select state from public.verify_tasks where id = (t2->>'id')::uuid) <> 'QUEUED' then raise exception '11b: per-task cancel spilled over'; end if;
  t := public.verify_task_enqueue(j2, 'enreg', 'enreg:C9', 'enreg:C9', '{}');
  if t->>'state' <> 'QUEUED' then raise exception '11b: cancelled task still holds the scope: %', t->>'state'; end if;

  -- 12. One advancer per job.
  if public.research_job_advance_acquire(j1, 30) is null then raise exception '12: first acquire failed'; end if;
  if public.research_job_advance_acquire(j1, 30) is not null then raise exception '12: second advancer admitted'; end if;

  -- 13. CAPTCHA ledger is idempotent per attempt.
  perform public.verify_captcha_record('task-x:1', null, j1, 'mygov', 'ACCEPTED', 0.003, 31000, 'recaptcha_v2');
  perform public.verify_captcha_record('task-x:1', null, j1, 'mygov', 'ACCEPTED', 0.003, 31000, 'recaptcha_v2');
  if (select count(*) from public.verify_captcha_events where idempotency_key = 'task-x:1') <> 1 then raise exception '13: duplicate captcha row'; end if;

  -- 14. Idempotent start: one job per (owner, client_request_id).
  insert into public.research_jobs (user_id, client_request_id) values ('00000000-0000-4000-8000-000000000009', 'req-1');
  begin
    insert into public.research_jobs (user_id, client_request_id) values ('00000000-0000-4000-8000-000000000009', 'req-1');
    raise exception '14: duplicate start accepted';
  exception when unique_violation then null;
  end;

  raise notice 'verify_durable_execution: all checks passed';
end;
$$;
