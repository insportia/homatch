-- The tick that makes Verify autonomous.
--
-- Recorded here so the repository matches production: this was applied
-- directly, and without the file a future reader would find the driver in
-- the code with nothing scheduling it.
--
-- Mirrors the existing homatch-worker-quarter-hour job exactly: the shared
-- secret is looked up from admin_settings at call time and never appears in
-- this file or in any committed artefact.
select cron.schedule(
  'homatch-verify-driver',
  '30 seconds',
  $cron$
  select net.http_post(
    url := 'https://ptxajsjhobhvsfhmutjn.supabase.co/functions/v1/research-agent',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-token', (select value #>> '{}' from public.admin_settings where key = 'verify_driver_token')
    ),
    body := '{"action":"drive"}'::jsonb,
    timeout_milliseconds := 8000
  );
  $cron$
);
