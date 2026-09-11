-- Two more credential names in the registry did not exist anywhere in the
-- codebase. Verified against what the edge functions actually read:
--
--   APIFY_TOKEN         referenced 0 times   ->  APIFY_API_TOKEN      (7)
--   BRIGHTDATA_TOKEN    referenced 0 times   ->  BRIGHTDATA_API_KEY   (1)
--
-- The Provider Connections screen tells an operator which variable to set.
-- Naming one that does not exist sends them to configure the wrong thing and
-- then wonder why nothing changed — worse than saying nothing at all. The
-- rest (OPENAI_API_KEY, DATAFORSEO_LOGIN, ZENROWS_API_KEY,
-- SCRAPINGBEE_API_KEY, RESEND_API_KEY, TWILIO_AUTH_TOKEN, RETELL_API_KEY,
-- GEMINI_API_KEY) were checked the same way and are correct.

UPDATE public.finance_provider_registry
   SET credential_env_var = 'APIFY_API_TOKEN'
 WHERE provider_id = 'APIFY';

UPDATE public.finance_provider_registry
   SET credential_env_var = 'BRIGHTDATA_API_KEY'
 WHERE provider_id = 'BRIGHTDATA';
