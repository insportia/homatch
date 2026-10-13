/** Normalizes existing HOMATCH rows; never invents missing information or image hashes. */
export function normalizeOwnedProperty(
  row: Record<string, any>,
  ownerId: string,
) {
  if (row.user_id !== ownerId || row.is_deleted)
    throw new Error('PROPERTY_NOT_OWNED');
  const facts = Array.isArray(row.facts)
    ? (row.facts[0] ?? {})
    : (row.facts ?? {});
  const finite = (v: unknown) =>
    v == null || v === ''
      ? undefined
      : Number.isFinite(Number(v))
        ? Number(v)
        : undefined;
  const typeMap: Record<string, string> = {
    APARTMENT: 'apartment',
    HOUSE: 'house',
    VILLA: 'house',
    LAND: 'land',
    COMMERCIAL: 'commercial',
    OFFICE: 'commercial',
    RETAIL: 'commercial',
    WAREHOUSE: 'commercial',
  };
  return {
    id: row.id,
    ownerId,
    version: 1,
    title: row.title ?? '',
    transaction:
      ({ SALE: 'sale', RENT: 'rent' } as Record<string, string>)[
        row.transaction_type
      ] ?? 'unknown',
    type: typeMap[row.property_type] ?? 'unknown',
    location: {
      country: facts.country ?? '',
      city: facts.city ?? '',
      district: facts.district,
      address: facts.address,
      latitude: finite(facts.latitude),
      longitude: finite(facts.longitude),
    },
    area: finite(facts.area),
    rooms: finite(facts.rooms),
    bedrooms: finite(facts.bedrooms),
    bathrooms: finite(facts.bathrooms),
    floor: finite(facts.floor),
    totalFloors: finite(facts.total_floors),
    condition: facts.construction_status,
    renovation: facts.condition,
    amenities: {
      furniture: facts.furnished,
      parking: facts.parking,
      balcony: facts.balcony,
      heating: facts.heating,
      elevator: facts.elevator,
    },
    price: {
      amount: finite(facts.total_price),
      currency: facts.currency ?? '',
    },
    contact: { phone: row.contact_phone_e164 ?? '' },
    description: facts.description ?? facts.original_description ?? '',
    photos: (Array.isArray(row.photos) ? [...row.photos] : [])
      .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
      .map((photo) => ({
        id: photo.id,
        storagePath: photo.storage_path,
        sha256: photo.sha256 ?? null,
        mime: photo.mime_type ?? null,
        bytes: photo.file_size ?? null,
        cover: Boolean(photo.is_cover),
      })),
    portalFields: {},
  };
}
