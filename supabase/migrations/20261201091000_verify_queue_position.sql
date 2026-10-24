-- Verify at scale: where a waiting job stands, and when it is likely to start.
--
-- For a job whose official tasks are still waiting in the queue: how many
-- tasks of the same lane are ahead of its first waiting one (same order the
-- claim uses: priority, run_after, created_at), and how fast that lane is
-- actually finishing tasks right now (last 15 minutes). The estimate is a
-- measurement, never a promise: with no recent throughput there is no ETA.

create or replace function public.verify_queue_position(p_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_first record;
  v_ahead integer;
  v_done integer;
  v_waiting integer;
begin
  select t.lane, t.priority, t.run_after, t.created_at
    into v_first
    from public.verify_tasks t
   where t.job_id = p_job_id and t.state in ('QUEUED', 'WAITING_SHARED') and t.source <> 'rstax'
   order by t.priority, t.run_after, t.created_at
   limit 1;
  select count(*) into v_waiting
    from public.verify_tasks t
   where t.job_id = p_job_id and t.state in ('QUEUED', 'WAITING_SHARED') and t.source <> 'rstax';
  if v_first is null then
    return jsonb_build_object('waiting', 0, 'ahead', 0, 'perMinute', null, 'etaSeconds', null);
  end if;
  select count(*) into v_ahead
    from public.verify_tasks t
   where t.state = 'QUEUED' and t.lane = v_first.lane and not t.cancel_requested
     and (t.priority, t.run_after, t.created_at) < (v_first.priority, v_first.run_after, v_first.created_at);
  select count(*) into v_done
    from public.verify_tasks t
   where t.lane = v_first.lane and t.finished_at > now() - interval '15 minutes'
     and t.state in ('SUCCEEDED', 'FAILED', 'DEAD');
  return jsonb_build_object(
    'waiting', v_waiting,
    'ahead', v_ahead,
    'lane', v_first.lane,
    'perMinute', round(v_done / 15.0, 2),
    'etaSeconds', case when v_done > 0 then ceil((v_ahead + 1) / (v_done / 15.0) * 60) else null end
  );
end;
$function$;

revoke all on function public.verify_queue_position(uuid) from public, anon, authenticated;
grant execute on function public.verify_queue_position(uuid) to service_role;
