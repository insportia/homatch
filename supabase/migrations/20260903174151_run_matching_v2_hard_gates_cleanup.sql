-- Task #60 (matching engine): run-matching-v2 previously only soft-capped a KNOWN
-- transaction-type / property-type / district mismatch at score 49 (still above the
-- 20-point floor), so incompatible matches were still created and shown to users —
-- e.g. a FOR_SALE property "matching" someone who explicitly wants to RENT, or a
-- Krtsanisi property matching someone who explicitly wants Saburtalo/Samgori/Bagebi.
-- The edge function itself is fixed (deployed separately, hard-rejects these going
-- forward). This is the one-time retroactive cleanup of matches created by the old,
-- too-permissive logic.
--
-- Scoped to status = 'NEW' ONLY. UNLOCKED/PREVIEWED/ARCHIVED rows are user-facing,
-- possibly-paid history and are never touched — verified live before running this
-- that zero UNLOCKED rows fail these checks, so no paid/credit-spent match is
-- affected. REJECTED (not deleted) so the audit trail and match id survive.
--
-- INVEST demand is deliberately treated as compatible with BOTH 'sale' and
-- 'investment' property transaction types (never flagged), matching the live data
-- pattern where the classifier records intent_profiles.transaction_type as either
-- value for the same buy-to-invest demand.
WITH candidates AS (
  SELECT m.id,
    CASE
      WHEN ip.intent_type::text = 'INVEST' THEN ARRAY['sale','investment']
      WHEN NULLIF(lower(ip.transaction_type), '') IS NOT NULL THEN ARRAY[lower(ip.transaction_type)]
      WHEN ip.intent_type::text IN ('BUY','RELOCATE_BUY') THEN ARRAY['sale']
      WHEN ip.intent_type::text IN ('RENT','RELOCATE_RENT') THEN ARRAY['rent']
      ELSE NULL
    END AS compat_txn,
    lower(p.transaction_type::text) AS prop_txn,
    pf.district AS prop_district, pf.neighborhood AS prop_neighborhood,
    pf.city AS prop_city, ip.city AS intent_city,
    ip.district AS intent_district, ip.neighborhoods AS intent_neighborhoods
  FROM matches m
  JOIN properties p ON p.id = m.property_id
  LEFT JOIN property_facts pf ON pf.property_id = p.id
  JOIN intent_profiles ip ON ip.id = m.intent_profile_id
  WHERE m.status = 'NEW'
),
flagged AS (
  SELECT id,
    (compat_txn IS NOT NULL AND prop_txn IS NOT NULL AND NOT (prop_txn = ANY(compat_txn))) AS txn_mismatch,
    (
      COALESCE(prop_district, prop_neighborhood) IS NOT NULL AND COALESCE(prop_district, prop_neighborhood) != ''
      AND (intent_district IS NOT NULL OR intent_neighborhoods IS NOT NULL)
      AND prop_city IS NOT NULL AND intent_city IS NOT NULL AND lower(prop_city) = lower(intent_city)
      AND NOT (
        (intent_district IS NOT NULL AND (lower(COALESCE(prop_district, prop_neighborhood)) LIKE '%'||lower(intent_district)||'%' OR lower(intent_district) LIKE '%'||lower(COALESCE(prop_district, prop_neighborhood))||'%'))
        OR EXISTS (SELECT 1 FROM unnest(COALESCE(intent_neighborhoods, ARRAY[]::text[])) n WHERE lower(COALESCE(prop_district, prop_neighborhood)) LIKE '%'||lower(n)||'%' OR lower(n) LIKE '%'||lower(COALESCE(prop_district, prop_neighborhood))||'%')
      )
    ) AS district_mismatch
  FROM candidates
)
UPDATE matches m SET status = 'REJECTED', updated_at = now()
FROM flagged f
WHERE m.id = f.id AND m.status = 'NEW' AND (f.txn_mismatch OR f.district_mismatch);
