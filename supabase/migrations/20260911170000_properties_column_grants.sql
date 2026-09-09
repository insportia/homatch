-- Homatch — a listing owner may describe their property, not rate it.
--
-- WHAT WAS FOUND
--
-- public.properties grants UPDATE on every column to authenticated and anon,
-- and props_update_own only checks WHICH row you may touch, never WHICH
-- columns. Three of those columns are not the customer's to write:
--
--   matchability_score   produced by run-matching-v2 under the service role
--                        and rendered on the dashboard as the property's
--                        matching strength. A customer could set their own
--                        listing to 100 and the dashboard would show it.
--
--   developer_id         the pivot behind /developer/:id. Writable by the
--   canonical_group_id   listing owner means anyone can attach their listing
--                        to any developer's profile -- claiming a reputable
--                        builder built it -- or into any canonical duplicate
--                        group, which is what the cross-source price
--                        comparison is computed from.
--
-- The last two arrived with 20260911140000_phase3_schema. That migration was
-- careful to revoke client writes on the derived TABLES and then added two
-- derived COLUMNS to a table that grants everything; this closes that.
--
-- source_type, user_id, id and created_at are revoked in the same pass. Row
-- ownership was already safe -- props_update_own's USING doubles as its WITH
-- CHECK, so a customer could not hand their property to someone else -- but
-- there is no reason for these to be writable and stating it in one place is
-- clearer than relying on that second-order property of the policy.
--
-- What a customer legitimately updates, from src/services/api.ts:
--   updateProperty()          title, matching_status, cover_photo_url,
--                             transaction_type, property_type
--   softDeleteProperty()      is_deleted
--   start/pauseMatchingCampaign()  matching_status
--
-- INSERT keeps its columns except the three derived ones: createProperty()
-- sets user_id, source_type, title, transaction_type, property_type and
-- matching_status, and a new listing has no score, no developer and no
-- canonical group to declare.
--
-- service_role is untouched and keeps full access -- run-matching-v2 and the
-- ingestion functions write these columns and must go on doing so.
--
-- Grants only. No policy, no data and no column definition changes.

revoke update on public.properties from authenticated, anon;

grant update (
  title,
  matching_status,
  cover_photo_url,
  transaction_type,
  property_type,
  is_deleted,
  updated_at
) on public.properties to authenticated;

revoke insert (matchability_score, developer_id, canonical_group_id)
  on public.properties from authenticated, anon;
