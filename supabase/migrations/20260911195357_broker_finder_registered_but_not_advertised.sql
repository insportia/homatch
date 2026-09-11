-- Homatch — do not sell a product that cannot run.
--
-- WHAT WAS FOUND
--
-- VERIFY, FIND_CLIENTS and CONTRACT_INTELLIGENCE all have a real execution
-- path in this codebase (homatch-research, match-campaign, and
-- deal-room-document-analyze respectively), and all three are now funded and
-- settled through the billing engine.
--
-- BROKER_FINDER does not. There is no broker-finding Edge Function, no service
-- call, no page and no translation key for it anywhere in the repository
-- except the pricing copy added alongside this work. The closest existing
-- feature, community-recommend, ranks COMMUNITIES and posting venues for a
-- property; calling that "Broker Finder" would be relabelling one product as
-- another, and its results are group posting policies rather than evidenced
-- broker contacts.
--
-- WHY enabled = false RATHER THAN DELETING THE ROWS
--
-- The plan matrix, the pricing, the allowances and the result ceilings for
-- Broker Finder are all correct and ready. They stay, so turning the product
-- on later is this one flag and nothing else -- which is the same extensibility
-- claim AI_CALL and EMAIL_CAMPAIGN are making. What must not happen in the
-- meantime is a pricing page promising "1 Broker Finder search every month"
-- that no code can honour.
--
-- billing_entitlements() and the catalogue both filter on enabled = true, so
-- this removes it from the pricing page, the comparison grid and every
-- customer-facing entitlement payload in one move.
--
-- TO ENABLE, once a real execution path exists:
--   UPDATE public.billable_products SET enabled = true WHERE code = 'BROKER_FINDER';

UPDATE public.billable_products
   SET enabled = false,
       config = config || jsonb_build_object(
         'disabled_reason',
         'Registered with full pricing and entitlements, but no execution path exists in the codebase yet. Enabling this flag is all that is required once one does. Deliberately not advertised until then.'),
       updated_at = now()
 WHERE code = 'BROKER_FINDER';

-- pricing_active stays TRUE: the economics are designed and approved, unlike
-- AI_CALL and EMAIL_CAMPAIGN whose pricing is explicitly a future exercise.
-- The distinction matters: this product is built and unplugged, those two are
-- unbuilt and unpriced.
COMMENT ON TABLE public.billable_products IS
  'Execution catalogue. enabled=false means the product must not be shown or run; pricing_active=false means it must never be charged for. BROKER_FINDER is enabled=false/pricing_active=true (priced, no code yet); AI_CALL and EMAIL_CAMPAIGN are both false (out of scope by mandate).';
