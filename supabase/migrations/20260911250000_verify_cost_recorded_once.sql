/* ══════════════════════════════════════════════════════════════════════
 * A VERIFICATION'S COST IS RECORDED ONCE, EVEN UNDER A RACE
 * ══════════════════════════════════════════════════════════════════════
 *
 * recordVerificationCost() already refuses to double-count: it counts the
 * existing VERIFY_% rows for the job and returns if there are any. That
 * handles a job re-driven after a resume, which is the case it was written
 * for, and it cannot handle two drivers finishing the same job at once —
 * both read zero, then both insert.
 *
 * Which is exactly what happened. One production verification recorded ten
 * cost rows instead of five, two per stage, sixteen milliseconds apart, with
 * identical token counts — the research ran once and the bookkeeping ran
 * twice. Its COGS therefore read 346,532 tokens and 22 web searches against a
 * true 173,266 and 11.
 *
 * A check-then-insert cannot fix this from application code. Only the
 * database can, so the rule lives here.
 *
 * SCOPED TO VERIFY_% DELIBERATELY. The same table carries the discovery
 * pipeline, where many events of one type per job are entirely correct — one
 * job legitimately holds forty-three CLASSIFY_SIGNAL rows and twelve
 * SERP_SEARCH rows. A blanket constraint would be wrong and would break it.
 * A verification has exactly five stages and records each of them once.
 */

/* The rows that were written twice. Keep the first of each pair: they are
 * byte-identical apart from the timestamp, so which one survives does not
 * matter, only that one does. */
delete from public.cost_events c
where c.operation_type like 'VERIFY\_%'
  and c.job_id is not null
  and exists (
    select 1 from public.cost_events k
    where k.job_id = c.job_id
      and k.operation_type = c.operation_type
      and (k.timestamp, k.id) < (c.timestamp, c.id)
  );

create unique index if not exists cost_events_verify_once_per_stage
  on public.cost_events (job_id, operation_type)
  where job_id is not null and operation_type like 'VERIFY\_%';

comment on index public.cost_events_verify_once_per_stage is
  'A verification records each of its five stages exactly once. The application also checks before inserting, but that check is a read-modify-write and two concurrent finishes both read zero — this is what actually makes it true.';
