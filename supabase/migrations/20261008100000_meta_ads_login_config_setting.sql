-- META ADS — the Facebook Login for Business configuration as an admin setting.
--
-- Which configuration the Connect button opens decides the screen Meta shows:
-- a SYSTEM-USER token configuration shows "Select the business assets to
-- share"; a USER access token configuration shows Meta's standard
-- "Continue as … / Edit settings" consent with Page selection. The value is a
-- public id (it is in every dialog URL), never a credential. Seeded with the
-- production configuration in use today, so nothing changes until an admin
-- switches it (with a reason, through admin_setting_set and its audit row).
insert into public.admin_settings (key, value, description) values
  ('meta_ads_login_config_id', '"970930962712211"'::jsonb,
   'Facebook Login for Business configuration id used by Connect Meta. A user-access-token configuration gives the standard consent screen with Page selection; a system-user configuration gives the business-asset sharing screen.')
on conflict (key) do nothing;
