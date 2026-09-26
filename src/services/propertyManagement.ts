// MANAGING A PROPERTY YOU ALREADY UPLOADED.
//
// Most of this already existed and is reused rather than rewritten: getProperties,
// getProperty, updateProperty, softDeleteProperty, upsertPropertyFacts,
// addPropertyPhoto, deletePropertyPhoto, setCoverPhoto and uploadPropertyPhoto all
// live in services/api.ts and all work. What was missing is everything that makes a
// portfolio manageable rather than merely viewable.
//
// WHAT IS NEW HERE, AND WHY EACH ONE HAD TO BE
//
//   listPortfolio      getProperties() filters `is_deleted = false` and nothing else,
//                      so an archived property would sit in the middle of the active
//                      list forever. This asks for one of three views explicitly.
//   reorderPhotos      display_order was written on insert and never changed again.
//                      A gallery whose order the owner cannot set is a slideshow.
//   archive/unarchive  the new archived_at column. See the migration for why it is
//                      not another matching_status value.
//   setPublication     ACTIVE / PAUSED / DRAFT, named as the three things they are
//                      instead of left to callers to remember.
//   allPhotos          getPropertyPhotos() is capped at `.limit(5)` and is used by
//                      screens that want a preview strip. A management page needs
//                      all of them, and quietly raising the cap on the shared
//                      function would change what those other screens render.
//
// OWNERSHIP IS NOT CHECKED HERE, AND THAT IS DELIBERATE.
//
// It is checked in Postgres. `properties` carries props_select_own /
// props_update_own / props_delete_own keyed on `user_id = get_user_id()`, and
// property_facts and property_photos key on `user_owns_property(property_id)`. So a
// client asking for somebody else's property gets nothing and a client writing to
// one gets a policy violation — enforced by the database under the signed-in
// person's own token, not by a filter this file has to remember to add. A
// `user_id` parameter here would be decoration, and decoration that looks like a
// security check is worse than none.
//
// PHOTOS ARE KEYS, NEVER URLS.
//
// `property-photos` is a private bucket. storage_path holds the key; a signed URL
// is minted when somebody looks and is never written down. Deleting a photo
// therefore has two halves — the row and the object — and they are done in that
// order on purpose: see removePhoto.

import { supabase } from '@/db/supabase';
import type { Property, PropertyPhoto } from '@/types/types';

/*
 * The two pure decisions a property makes about itself live in src/property/rules.ts
 * and are re-exported here so callers have one import. They are NOT defined here
 * because this file imports the Supabase client, and a rule that cannot be tested
 * without a database is a rule nobody tests.
 */
export {
  type PropertyIntelligenceAction,
  intelligenceActionFor,
  isImported,
} from '@/property/rules';

/** The three ways an owner can be looking at their portfolio. */
export type PortfolioView = 'ACTIVE' | 'ARCHIVED' | 'ALL';

/** ACTIVE / PAUSED / DRAFT, as the product's matching_status enum spells them. */
export type PublicationState = 'ACTIVE' | 'PAUSED' | 'DRAFT' | 'COMPLETED';

const PROPERTY_SELECT = `
  *,
  facts:property_facts(*),
  photos:property_photos(id, storage_path, public_url, is_cover, display_order, visibility)
`;

/**
 * One page of the owner's portfolio.
 *
 * Archived properties are excluded from ACTIVE rather than sorted to the bottom: an
 * owner with forty archived listings and three live ones should not have to scroll
 * past last year to reach this week.
 */
export async function listPortfolio(options: {
  userId: string;
  view?: PortfolioView;
  limit?: number;
  cursor?: string;
} = { userId: '' }): Promise<Property[]> {
  const { userId, view = 'ACTIVE', limit = 50, cursor } = options;
  if (!userId) return [];

  let query = supabase
    .from('properties')
    .select(PROPERTY_SELECT)
    .eq('user_id', userId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (view === 'ACTIVE') query = query.is('archived_at', null);
  if (view === 'ARCHIVED') query = query.not('archived_at', 'is', null);
  if (cursor) query = query.lt('created_at', cursor);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? (data as unknown as Property[]) : [];
}

/** How many properties are in each view, so a tab can carry a real count. */
export async function portfolioCounts(userId: string): Promise<{
  active: number; archived: number;
}> {
  const base = () => supabase
    .from('properties')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_deleted', false);

  const [{ count: active }, { count: archived }] = await Promise.all([
    base().is('archived_at', null),
    base().not('archived_at', 'is', null),
  ]);
  return { active: active ?? 0, archived: archived ?? 0 };
}

/** One property, with its facts and every photo. */
export async function readProperty(id: string): Promise<Property | null> {
  const { data, error } = await supabase
    .from('properties')
    .select(`*, facts:property_facts(*), photos:property_photos(*)`)
    .eq('id', id)
    .eq('is_deleted', false)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as Property) ?? null;
}

/**
 * Every photo, in the owner's order.
 *
 * Separate from getPropertyPhotos() because that one is capped at five for the
 * preview strips that use it. Raising its cap would silently change what three other
 * screens render, which is not a thing to do on the way past.
 */
export async function allPhotos(propertyId: string): Promise<PropertyPhoto[]> {
  const { data, error } = await supabase
    .from('property_photos')
    .select('*')
    .eq('property_id', propertyId)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(60);
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

/**
 * Write the gallery order the owner dragged into place.
 *
 * ONE UPDATE PER PHOTO, which is not elegant and is correct: PostgREST has no
 * multi-row-different-values update, and the alternative — a delete-and-reinsert —
 * would destroy the rows a photo's storage key lives on if anything failed halfway.
 * Failures are collected rather than thrown on the first one, so a caller learns the
 * order is partially applied instead of being told nothing happened when something
 * did.
 */
export async function reorderPhotos(
  propertyId: string, orderedIds: string[],
): Promise<{ applied: number; failures: string[] }> {
  const failures: string[] = [];
  let applied = 0;

  for (const [index, id] of orderedIds.entries()) {
    const { data, error } = await supabase
      .from('property_photos')
      .update({ display_order: index })
      .eq('id', id)
      .eq('property_id', propertyId)
      .select('id');
    if (error) {
      failures.push(`${id}: ${error.message}`);
      continue;
    }
    /* An update that matched nothing is not a success. PostgREST returns 204 for
       both, which is why .select() is here. */
    if (!data || data.length === 0) {
      failures.push(`${id}: no longer part of this property`);
      continue;
    }
    applied += 1;
  }
  return { applied, failures };
}

/**
 * Remove a photo: the row first, then the object.
 *
 * THAT ORDER IS THE POINT. If the row goes and the object lingers, the result is an
 * orphaned private object nobody can reach — wasted bytes and nothing more. If the
 * object went first and the row write failed, the property would hold a row pointing
 * at nothing and the gallery would render a permanent broken image. One of those
 * failures is invisible and cheap; the other is visible and wrong.
 *
 * The object delete is therefore allowed to fail without failing the call, and says
 * so rather than being swallowed.
 */
export async function removePhoto(photo: { id: string; storage_path?: string | null }): Promise<{
  rowDeleted: boolean; objectDeleted: boolean; note: string | null;
}> {
  const { data, error } = await supabase
    .from('property_photos')
    .delete()
    .eq('id', photo.id)
    .select('id,storage_path');
  if (error) throw new Error(`Could not remove the photo: ${error.message}`);
  if (!data || data.length === 0) throw new Error('That photo no longer exists.');

  const key = data[0]?.storage_path ?? photo.storage_path ?? null;
  if (!key) return { rowDeleted: true, objectDeleted: false, note: 'no stored object' };

  try {
    const { deleteObject } = await import('@/services/storage/objectStore');
    await deleteObject(key);
    return { rowDeleted: true, objectDeleted: true, note: null };
  } catch (error_) {
    return {
      rowDeleted: true,
      objectDeleted: false,
      note: error_ instanceof Error ? error_.message : String(error_),
    };
  }
}

/**
 * Add a photo that has already been uploaded to storage.
 *
 * display_order goes on the END rather than at zero, and is_cover is true only when
 * there is no cover yet: uploading a second photo should not silently replace the
 * cover the owner chose.
 */
export async function attachPhoto(input: {
  propertyId: string;
  storagePath: string;
  originalFilename?: string | null;
  fileSize?: number | null;
}): Promise<string> {
  const existing = await allPhotos(input.propertyId);
  const nextOrder = existing.reduce(
    (max, photo) => Math.max(max, Number(photo.display_order ?? 0) + 1), 0,
  );
  const isFirst = existing.length === 0;

  const { data, error } = await supabase
    .from('property_photos')
    .insert({
      property_id: input.propertyId,
      storage_path: input.storagePath,
      display_order: nextOrder,
      is_cover: isFirst,
      /* The bucket is private; the column is what the authoriser reads. */
      visibility: 'PRIVATE',
      original_filename: input.originalFilename ?? null,
      file_size: input.fileSize ?? null,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Could not save the photo: ${error.message}`);

  /*
   * properties.cover_photo_url holds the cover's KEY -- not a URL, whatever the
   * column is called. Kept in step here so the portfolio list can render a cover
   * without joining photos, and only when this photo actually became the cover.
   */
  if (isFirst) {
    await supabase.from('properties')
      .update({ cover_photo_url: input.storagePath, updated_at: new Date().toISOString() })
      .eq('id', input.propertyId);
  }
  return data.id as string;
}

/** Choose the cover, and keep properties.cover_photo_url in step with it. */
export async function chooseCover(propertyId: string, photoId: string): Promise<void> {
  const { error: clearError } = await supabase
    .from('property_photos')
    .update({ is_cover: false })
    .eq('property_id', propertyId);
  if (clearError) throw new Error(`Could not change the cover: ${clearError.message}`);

  const { data, error } = await supabase
    .from('property_photos')
    .update({ is_cover: true })
    .eq('id', photoId)
    .eq('property_id', propertyId)
    .select('id,storage_path');
  if (error) throw new Error(`Could not change the cover: ${error.message}`);
  if (!data || data.length === 0) throw new Error('That photo is no longer part of this property.');

  await supabase.from('properties')
    .update({
      cover_photo_url: data[0]?.storage_path ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', propertyId);
}

/* ------------------------------------------------------------------ *
 * Lifecycle                                                          *
 * ------------------------------------------------------------------ */

/**
 * ACTIVE, PAUSED or DRAFT.
 *
 * This is the MATCHING state and nothing else. It does not archive, does not
 * delete, and does not decide whether the listing exists -- the migration that
 * added archived_at explains why those are separate questions.
 */
export async function setPublication(
  propertyId: string, state: PublicationState,
): Promise<void> {
  const { data, error } = await supabase
    .from('properties')
    .update({ matching_status: state, updated_at: new Date().toISOString() })
    .eq('id', propertyId)
    .select('id');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error('That property is no longer available to change.');
}

/**
 * Archive, and stop matching while doing it.
 *
 * PAUSING IS PART OF ARCHIVING, and un-archiving deliberately does NOT resume.
 * Leaving a campaign running against a listing the owner has put away would spend
 * their budget on something they are finished with; resuming it automatically on
 * un-archive would start spending again on a decision they have not made. So the
 * destructive-to-spending direction is automatic and the spending direction is not.
 */
export async function archiveProperty(propertyId: string): Promise<void> {
  const { data, error } = await supabase
    .from('properties')
    .update({
      archived_at: new Date().toISOString(),
      matching_status: 'PAUSED',
      updated_at: new Date().toISOString(),
    })
    .eq('id', propertyId)
    .select('id');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error('That property is no longer available to archive.');
}

/** Bring it back. Matching stays paused; see archiveProperty. */
export async function unarchiveProperty(propertyId: string): Promise<void> {
  const { data, error } = await supabase
    .from('properties')
    .update({ archived_at: null, updated_at: new Date().toISOString() })
    .eq('id', propertyId)
    .select('id');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error('That property is no longer available.');
}

/**
 * Delete, which is the existing soft delete.
 *
 * `is_deleted = true` rather than a DELETE, because a property has matches,
 * campaigns, a search profile and a ledger history hanging off it, and removing the
 * row would take an audit trail with it. The customer's experience is that it is
 * gone; the record of what was charged for it survives.
 */
export async function deleteProperty(propertyId: string): Promise<void> {
  const { data, error } = await supabase
    .from('properties')
    .update({
      is_deleted: true,
      matching_status: 'PAUSED',
      updated_at: new Date().toISOString(),
    })
    .eq('id', propertyId)
    .select('id');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error('That property is no longer available to delete.');
}

/* ------------------------------------------------------------------ *
 * Editing                                                            *
 * ------------------------------------------------------------------ */

export interface PropertyEdits {
  title?: string | null;
  transactionType?: 'SALE' | 'RENT' | 'INVESTMENT';
  propertyType?: string;
}

export interface FactEdits {
  city?: string | null;
  district?: string | null;
  address?: string | null;
  totalPrice?: number | null;
  currency?: string | null;
  area?: number | null;
  rooms?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  floor?: number | null;
  totalFloors?: number | null;
  description?: string | null;
  addressVisibility?: 'FULL' | 'CITY_ONLY' | 'HIDDEN';
}

/**
 * Save an edit to both halves of a property.
 *
 * `properties` holds what the product is (title, transaction, type) and
 * `property_facts` holds what the property is (price, rooms, where). Two tables
 * because an import writes the second from a page it read and the first from our own
 * classification, and one UPDATE cannot span them.
 *
 * PRICE PER m² IS DERIVED, NOT ASKED FOR. It is shown everywhere and typing it is a
 * way to enter a number that contradicts the other two. Recomputed whenever either
 * input moves, and left alone when neither does.
 *
 * WHAT THIS WILL NOT TOUCH: source_url, canonical_url, external_listing_id,
 * source_domain, original_description, original_title. Those record what an external
 * page said, and editing the Homatch copy does not edit the listing it came from.
 * Overwriting them would erase the only evidence of where a fact originated.
 */
export async function savePropertyEdits(input: {
  propertyId: string;
  property?: PropertyEdits;
  facts?: FactEdits;
}): Promise<void> {
  const now = new Date().toISOString();

  if (input.property && Object.keys(input.property).length > 0) {
    const row: Record<string, unknown> = { updated_at: now };
    if ('title' in input.property) row.title = input.property.title;
    if (input.property.transactionType) row.transaction_type = input.property.transactionType;
    if (input.property.propertyType) row.property_type = input.property.propertyType;

    const { data, error } = await supabase
      .from('properties').update(row).eq('id', input.propertyId).select('id');
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error('That property is no longer available to edit.');
  }

  if (input.facts && Object.keys(input.facts).length > 0) {
    const f = input.facts;
    const row: Record<string, unknown> = { property_id: input.propertyId, updated_at: now };
    if ('city' in f) row.city = f.city;
    if ('district' in f) row.district = f.district;
    if ('address' in f) row.address = f.address;
    if ('totalPrice' in f) row.total_price = f.totalPrice;
    if ('currency' in f) row.currency = f.currency;
    if ('area' in f) row.area = f.area;
    if ('rooms' in f) row.rooms = f.rooms;
    if ('bedrooms' in f) row.bedrooms = f.bedrooms;
    if ('bathrooms' in f) row.bathrooms = f.bathrooms;
    if ('floor' in f) row.floor = f.floor;
    if ('totalFloors' in f) row.total_floors = f.totalFloors;
    if ('description' in f) row.description = f.description;
    if (f.addressVisibility) row.address_visibility = f.addressVisibility;

    /* Derived, and only when both inputs are actually present and usable. */
    const price = f.totalPrice;
    const area = f.area;
    if (typeof price === 'number' && Number.isFinite(price) && price > 0
      && typeof area === 'number' && Number.isFinite(area) && area > 0) {
      row.price_per_sqm = Number((price / area).toFixed(2));
    }

    const { error } = await supabase
      .from('property_facts').upsert(row, { onConflict: 'property_id' });
    if (error) throw new Error(error.message);
  }
}
