-- The registry named STRIPE_SECRET_KEY. This repository reads
-- PAYMENT_PROVIDER_SECRET (and PAYMENT_WEBHOOK_SECRET) — provider-health-check
-- and payment_provider.ts both do. Naming a variable that does not exist sends
-- an operator to set the wrong thing, which is worse than saying nothing.
--
-- An earlier correction was rolled back by an unrelated statement timeout in
-- the same transaction, which is why it is landing as its own migration.

UPDATE public.finance_provider_registry
   SET credential_env_var = 'PAYMENT_PROVIDER_SECRET',
       missing_permission = 'PAYMENT_PROVIDER_SECRET and PAYMENT_WEBHOOK_SECRET are not set. '
         || 'Until they are, revenue reads as NOT CONFIGURED rather than zero, and the '
         || 'webhook refuses to mint credits at all.'
 WHERE provider_id = 'STRIPE';
