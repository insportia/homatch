-- META ADS: an every-minute status reconciliation, apart from the 15-minute
-- maintenance pass.
--
-- meta-ads-api action `status_sync` reads only each live campaign's status at
-- Meta (campaign + ads; no insights, no Guard, no analysis): reviewing and
-- delivering campaigns every minute, paused ones every fifth minute, ended
-- ones never. Campaigns are grouped by (customer, ad account): two light
-- Graph reads per ad account per run, however many campaigns it holds. A
-- campaign synced in the last 50 seconds is skipped, at most 200 campaigns /
-- 40 seconds are handled per run, and an account whose Meta-reported usage is
-- high (meta_api_usage) is slowed or skipped. The heavy work stays on
-- `homatch-meta-ads-maintenance` (every 15 minutes).
--
-- Same Vault-held token as the maintenance job; nothing secret is written here.
do $$
begin
  if to_regproc('vault.create_secret') is null then return; end if;
  if exists (select 1 from cron.job where jobname = 'homatch-meta-ads-status-sync') then
    perform cron.unschedule('homatch-meta-ads-status-sync');
  end if;
  perform cron.schedule(
    'homatch-meta-ads-status-sync',
    '* * * * *',
    $cron$
    select net.http_post(
      url := 'https://ptxajsjhobhvsfhmutjn.supabase.co/functions/v1/meta-ads-api',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-cron-token', (select decrypted_secret from vault.decrypted_secrets where name = 'meta_ads_maintenance_token' limit 1)),
      body := '{"action":"status_sync"}'::jsonb,
      timeout_milliseconds := 55000
    );
    $cron$
  );
end $$;
