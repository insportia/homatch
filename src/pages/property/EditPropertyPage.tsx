// src/pages/property/EditPropertyPage.tsx — EDIT PROPERTY.
//
// The other half of My Properties. A property that cannot be edited after upload is a
// form submission, not a listing.
//
// PROGRESSIVE DISCLOSURE, BECAUSE THE FULL FORM IS UNUSABBLE ON A PHONE
//
// property_facts has forty columns. A single scroll containing all of them is the
// generic marketplace form this is meant not to be, and on a 320px screen it is a
// thousand pixels of fields before the one somebody came to change. So it is four
// sections, each collapsible, each independently saveable:
//
//   BASICS      title, what kind, sale or rent. What the listing IS.
//   PRICE       amount, currency, area — and price per m² shown, never typed.
//   LOCATION    city, district, address, and who may see the address.
//   DESCRIPTION the words.
//   PHOTOS      the gallery, its order, and the cover.
//
// BASICS and PRICE are open on arrival because they are what changes; the rest start
// closed. The section that was deep-linked opens regardless — /property/:id/edit#photos
// from the portfolio menu lands with Photos open and scrolled to.
//
// PRICE PER m² IS DERIVED AND DISPLAYED, NEVER ASKED FOR. It is on every card and in
// every comparison, and a field for it is a way to enter a third number that
// contradicts the other two. Recomputed on save from price and area.
//
// AN IMPORTED PROPERTY IS A COPY, AND SAYS SO
//
// A URL_IMPORT property was read off somebody else's page. Editing here changes the
// Homatch copy and does not touch the original — so the page says that in as many
// words, and the provenance fields (source_url, source_domain, original_title,
// original_description) are shown READ-ONLY rather than hidden or made editable.
// Hiding them would lose the evidence of where a fact came from; making them editable
// would let the record of what a page said be rewritten.
//
// PHOTOS: THE BUCKET IS PRIVATE AND THE COLUMN HOLDS A KEY
//
// Upload goes through the existing storage-sign path — the browser never holds a
// credential and never sees a bucket name. What gets stored is the key; a signed URL
// is minted when somebody looks and is never written down. Reorder writes
// display_order; cover writes is_cover AND properties.cover_photo_url so the
// portfolio can render a cover without joining photos.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle, ArrowLeft, Camera, ChevronDown, ChevronUp, ExternalLink, ImageOff,
  Loader2, MapPin, Save, Star, Trash2, Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { PrivateImage } from '@/components/common/PrivateImage';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import type { Property, PropertyPhoto } from '@/types/types';
import { uploadPropertyPhoto } from '@/services/api';
import {
  allPhotos,
  attachPhoto,
  chooseCover,
  isImported,
  readProperty,
  removePhoto,
  reorderPhotos,
  savePropertyEdits,
} from '@/services/propertyManagement';

const PROPERTY_TYPES = [
  'APARTMENT', 'HOUSE', 'VILLA', 'COMMERCIAL', 'LAND', 'OFFICE',
  'PENTHOUSE', 'STUDIO', 'TOWNHOUSE', 'OTHER',
] as const;
const TRANSACTIONS = ['SALE', 'RENT', 'INVESTMENT'] as const;
const CURRENCIES = ['USD', 'GEL', 'EUR'] as const;
const ADDRESS_VISIBILITY = ['FULL', 'CITY_ONLY', 'HIDDEN'] as const;

type SectionKey = 'basics' | 'price' | 'location' | 'description' | 'photos';

/** A collapsible section. Open state is the caller's so a deep link can set it. */
function Section({
  id, title, open, onToggle, children,
}: {
  id: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card id={id} className="bg-card border-border">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 p-4 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-t-xl"
      >
        <span className="text-sm font-semibold text-foreground break-words min-w-0">{title}</span>
        {open
          ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
          : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </button>
      {open && <CardContent className="px-4 pb-4 pt-0 space-y-3">{children}</CardContent>}
    </Card>
  );
}

/** A labelled field. A label element, so tapping the label focuses the input. */
function Field({
  label, htmlFor, children, hint,
}: { label: string; htmlFor: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5 min-w-0">
      <label htmlFor={htmlFor} className="text-sm font-medium text-foreground break-words block">
        {label}
      </label>
      {children}
      {hint && <p className="text-[13px] text-muted-foreground/70 break-words">{hint}</p>}
    </div>
  );
}

export default function EditPropertyPage() {
  const { t } = useLanguage();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { homatchUser } = useAuth();

  const [property, setProperty] = useState<Property | null>(null);
  const [photos, setPhotos] = useState<PropertyPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(0);
  const fileInput = useRef<HTMLInputElement | null>(null);

  /* The edited values. Held separately from `property` so an unsaved edit is
     distinguishable from a stored one and a failed save does not lose typing. */
  const [title, setTitle] = useState('');
  const [propertyType, setPropertyType] = useState<string>('APARTMENT');
  const [transaction, setTransaction] = useState<string>('SALE');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState<string>('USD');
  const [area, setArea] = useState('');
  const [rooms, setRooms] = useState('');
  const [bedrooms, setBedrooms] = useState('');
  const [bathrooms, setBathrooms] = useState('');
  const [floor, setFloor] = useState('');
  const [totalFloors, setTotalFloors] = useState('');
  const [city, setCity] = useState('');
  const [district, setDistrict] = useState('');
  const [address, setAddress] = useState('');
  const [addressVisibility, setAddressVisibility] = useState<string>('CITY_ONLY');
  const [description, setDescription] = useState('');

  const deepLink = (typeof window !== 'undefined' ? window.location.hash : '').replace('#', '');
  const [open, setOpen] = useState<Record<SectionKey, boolean>>({
    basics: true,
    price: true,
    location: deepLink === 'location',
    description: deepLink === 'description',
    photos: deepLink === 'photos',
  });
  const toggle = (key: SectionKey) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  const facts = useMemo(() => (
    (Array.isArray(property?.facts) ? property?.facts[0] : property?.facts) as
      Record<string, unknown> | null | undefined
  ), [property]);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setFailed(null);
    try {
      const [row, gallery] = await Promise.all([readProperty(id), allPhotos(id)]);
      if (!row) {
        /*
         * NOT FOUND AND NOT PERMITTED look identical here on purpose, because RLS
         * makes them identical: a property belonging to somebody else simply is not
         * in this account's result set. Saying "you are not allowed to see this"
         * would confirm it exists.
         */
        setFailed(t('prop_edit_not_found'));
        return;
      }
      setProperty(row);
      setPhotos(gallery);

      const f = (Array.isArray(row.facts) ? row.facts[0] : row.facts) as
        Record<string, unknown> | null | undefined;
      setTitle(String(row.title ?? ''));
      setPropertyType(String(row.property_type ?? 'APARTMENT'));
      setTransaction(String(row.transaction_type ?? 'SALE'));
      setPrice(f?.total_price !== null && f?.total_price !== undefined ? String(f.total_price) : '');
      setCurrency(String(f?.currency ?? 'USD'));
      setArea(f?.area !== null && f?.area !== undefined ? String(f.area) : '');
      setRooms(f?.rooms !== null && f?.rooms !== undefined ? String(f.rooms) : '');
      setBedrooms(f?.bedrooms !== null && f?.bedrooms !== undefined ? String(f.bedrooms) : '');
      setBathrooms(f?.bathrooms !== null && f?.bathrooms !== undefined ? String(f.bathrooms) : '');
      setFloor(f?.floor !== null && f?.floor !== undefined ? String(f.floor) : '');
      setTotalFloors(f?.total_floors !== null && f?.total_floors !== undefined ? String(f.total_floors) : '');
      setCity(String(f?.city ?? ''));
      setDistrict(String(f?.district ?? ''));
      setAddress(String(f?.address ?? ''));
      setAddressVisibility(String(f?.address_visibility ?? 'CITY_ONLY'));
      setDescription(String(f?.description ?? ''));
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => { void load(); }, [load]);

  /* Scroll the deep-linked section into view once it has rendered. */
  useEffect(() => {
    if (loading || !deepLink) return;
    const timer = window.setTimeout(() => {
      document.getElementById(`section-${deepLink}`)?.scrollIntoView({
        behavior: 'smooth', block: 'start',
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [loading, deepLink]);

  /** A number the database can hold, or null. Never NaN and never a silent 0. */
  const num = (value: string): number | null => {
    const text = value.trim();
    if (!text) return null;
    const parsed = Number(text);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  const int = (value: string): number | null => {
    const parsed = num(value);
    return parsed === null ? null : Math.trunc(parsed);
  };

  /** Shown, never typed. Recomputed live so the owner sees what will be stored. */
  const derivedPerSqm = useMemo(() => {
    const p = num(price);
    const a = num(area);
    if (p === null || a === null || p <= 0 || a <= 0) return null;
    return (p / a).toFixed(2);
  }, [price, area]);

  const invalid = useMemo(() => {
    const problems: string[] = [];
    if (!title.trim()) problems.push(t('prop_edit_need_title'));
    if (price.trim() && num(price) === null) problems.push(t('prop_edit_bad_price'));
    if (area.trim() && num(area) === null) problems.push(t('prop_edit_bad_area'));
    return problems;
  }, [title, price, area, t]);

  const save = async () => {
    if (!id || invalid.length > 0) return;
    setSaving(true);
    try {
      await savePropertyEdits({
        propertyId: id,
        property: {
          title: title.trim() || null,
          transactionType: transaction as 'SALE' | 'RENT' | 'INVESTMENT',
          propertyType,
        },
        facts: {
          city: city.trim() || null,
          district: district.trim() || null,
          address: address.trim() || null,
          totalPrice: num(price),
          currency,
          area: num(area),
          rooms: int(rooms),
          bedrooms: int(bedrooms),
          bathrooms: int(bathrooms),
          floor: int(floor),
          totalFloors: int(totalFloors),
          description: description.trim() || null,
          addressVisibility: addressVisibility as 'FULL' | 'CITY_ONLY' | 'HIDDEN',
        },
      });
      toast.success(t('prop_saved'));
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const addPhotos = async (files: FileList | null) => {
    if (!files || !id || !homatchUser?.id) return;
    const chosen = [...files].slice(0, 12);
    setUploading(chosen.length);
    let added = 0;
    for (const file of chosen) {
      try {
        const key = await uploadPropertyPhoto(homatchUser.id, id, file);
        await attachPhoto({
          propertyId: id,
          storagePath: key,
          originalFilename: file.name,
          fileSize: file.size,
        });
        added += 1;
      } catch (error) {
        /* Per file, so nine good uploads are not lost to one bad one. */
        toast.error(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setUploading((count) => Math.max(0, count - 1));
      }
    }
    if (added > 0) {
      setPhotos(await allPhotos(id));
      await load();
    }
  };

  /**
   * Move a photo one place, and persist the whole order.
   *
   * Buttons rather than drag-and-drop, deliberately: a drag target is the least
   * reliable interaction on a touchscreen, and reordering six photos on a phone with
   * drag handles is worse than tapping an arrow twice. The order is written for every
   * photo after a move, because display_order is only meaningful as a sequence.
   */
  const move = async (index: number, delta: -1 | 1) => {
    if (!id) return;
    const next = [...photos];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setPhotos(next);
    const result = await reorderPhotos(id, next.map((photo) => String(photo.id)));
    if (result.failures.length > 0) {
      toast.error(t('prop_photo_order_partial'));
      setPhotos(await allPhotos(id));
    }
  };

  const setCover = async (photoId: string) => {
    if (!id) return;
    try {
      await chooseCover(id, photoId);
      setPhotos(await allPhotos(id));
      await load();
      toast.success(t('prop_saved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const drop = async (photo: PropertyPhoto) => {
    if (!id) return;
    try {
      const result = await removePhoto({ id: String(photo.id), storage_path: photo.storage_path });
      setPhotos(await allPhotos(id));
      await load();
      /* An orphaned object is worth mentioning and is not a failure of the removal. */
      if (!result.objectDeleted && result.note) toast.success(t('prop_photo_removed_row_only'));
      else toast.success(t('prop_saved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const imported = isImported(property?.source_type as string | null);

  if (loading) {
    return (
      <RouteGuard>
        <AppLayout>
          <div className="max-w-2xl mx-auto space-y-4">
            <Skeleton className="h-10 rounded-lg" />
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </div>
        </AppLayout>
      </RouteGuard>
    );
  }

  if (failed || !property) {
    return (
      <RouteGuard>
        <AppLayout>
          <div className="max-w-2xl mx-auto space-y-4">
            <Card className="bg-card border-border">
              <CardContent className="p-6 text-center space-y-3">
                <AlertCircle className="h-9 w-9 mx-auto opacity-40" />
                <p className="text-sm text-muted-foreground break-words">
                  {failed ?? t('prop_edit_not_found')}
                </p>
                <Button size="sm" variant="outline" onClick={() => navigate('/property')}>
                  <ArrowLeft className="h-4 w-4 me-1.5 shrink-0" />
                  <span className="break-words">{t('prop_back_to_portfolio')}</span>
                </Button>
              </CardContent>
            </Card>
          </div>
        </AppLayout>
      </RouteGuard>
    );
  }

  return (
    <RouteGuard>
      <AppLayout>
        <div className="max-w-2xl mx-auto space-y-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="min-w-0 space-y-1">
              <h1 className="text-xl font-bold text-foreground break-words">
                {t('prop_edit_title')}
              </h1>
              <p className="text-sm text-muted-foreground break-words [overflow-wrap:anywhere]">
                {String(property.title ?? t('prop_untitled'))}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/property')}>
              <ArrowLeft className="h-4 w-4 me-1.5 shrink-0" />
              <span className="break-words">{t('prop_back_to_portfolio')}</span>
            </Button>
          </div>

          {/*
            AN IMPORTED PROPERTY IS A COPY. Said in words, at the top, before any
            field — not as a tooltip on a disabled input somebody has to discover.
          */}
          {imported && (
            <Card className="bg-card border-border">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-start gap-2 min-w-0">
                  <Badge variant="outline" className="shrink-0 whitespace-normal">
                    <span className="break-words">{t('prop_source_imported')}</span>
                  </Badge>
                  <p className="text-[13px] text-muted-foreground break-words min-w-0">
                    {t('prop_imported_note')}
                  </p>
                </div>
                {/* READ-ONLY PROVENANCE. Shown because it is evidence; not editable
                    because rewriting it would erase what the source page said. */}
                {Boolean(facts?.source_url) && (
                  <a
                    href={String(facts?.source_url)}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="inline-flex items-start gap-1.5 text-[13px] text-primary hover:underline min-w-0"
                  >
                    <ExternalLink className="h-3 w-3 shrink-0 mt-0.5" />
                    <span className="break-words min-w-0 [overflow-wrap:anywhere]">
                      {String(facts?.source_domain ?? facts?.source_url)}
                    </span>
                  </a>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── BASICS ──────────────────────────────────────────────────── */}
          <Section
            id="section-basics"
            title={t('prop_section_basics')}
            open={open.basics}
            onToggle={() => toggle('basics')}
          >
            <Field label={t('prop_field_title')} htmlFor="prop-title">
              <Input
                id="prop-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="h-9 text-sm"
              />
            </Field>
            <Field label={t('prop_field_type')} htmlFor="prop-type">
              <Select value={propertyType} onValueChange={setPropertyType}>
                <SelectTrigger id="prop-type" className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROPERTY_TYPES.map((kind) => (
                    <SelectItem key={kind} value={kind} className="text-sm">
                      {t(`prop_type_${kind.toLowerCase()}` as never)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              label={t('prop_field_transaction')}
              htmlFor="prop-txn"
              hint={t('prop_field_transaction_hint')}
            >
              <Select value={transaction} onValueChange={setTransaction}>
                <SelectTrigger id="prop-txn" className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRANSACTIONS.map((kind) => (
                    <SelectItem key={kind} value={kind} className="text-sm">
                      {t(`prop_txn_${kind.toLowerCase()}` as never)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </Section>

          {/* ── PRICE ───────────────────────────────────────────────────── */}
          <Section
            id="section-price"
            title={t('prop_section_price')}
            open={open.price}
            onToggle={() => toggle('price')}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t('prop_field_price')} htmlFor="prop-price">
                <Input
                  id="prop-price"
                  type="number"
                  inputMode="decimal"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                  className="h-9 text-sm"
                />
              </Field>
              <Field label={t('prop_field_currency')} htmlFor="prop-currency">
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger id="prop-currency" className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((code) => (
                      <SelectItem key={code} value={code} className="text-sm">{code}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t('prop_field_area')} htmlFor="prop-area">
                <Input
                  id="prop-area"
                  type="number"
                  inputMode="decimal"
                  value={area}
                  onChange={(event) => setArea(event.target.value)}
                  className="h-9 text-sm"
                />
              </Field>
              <Field label={t('prop_field_rooms')} htmlFor="prop-rooms">
                <Input
                  id="prop-rooms"
                  type="number"
                  inputMode="numeric"
                  value={rooms}
                  onChange={(event) => setRooms(event.target.value)}
                  className="h-9 text-sm"
                />
              </Field>
              <Field label={t('prop_bedrooms')} htmlFor="prop-bedrooms">
                <Input
                  id="prop-bedrooms"
                  type="number"
                  inputMode="numeric"
                  value={bedrooms}
                  onChange={(event) => setBedrooms(event.target.value)}
                  className="h-9 text-sm"
                />
              </Field>
              <Field label={t('prop_bathrooms')} htmlFor="prop-bathrooms">
                <Input
                  id="prop-bathrooms"
                  type="number"
                  inputMode="numeric"
                  value={bathrooms}
                  onChange={(event) => setBathrooms(event.target.value)}
                  className="h-9 text-sm"
                />
              </Field>
              <Field label={t('prop_field_floor')} htmlFor="prop-floor">
                <Input
                  id="prop-floor"
                  type="number"
                  inputMode="numeric"
                  value={floor}
                  onChange={(event) => setFloor(event.target.value)}
                  className="h-9 text-sm"
                />
              </Field>
              <Field label={t('prop_field_total_floors')} htmlFor="prop-total-floors">
                <Input
                  id="prop-total-floors"
                  type="number"
                  inputMode="numeric"
                  value={totalFloors}
                  onChange={(event) => setTotalFloors(event.target.value)}
                  className="h-9 text-sm"
                />
              </Field>
            </div>
            {/* DERIVED, AND SHOWN AS DERIVED. There is no field for it. */}
            <div className="rounded-lg border border-border/50 bg-background/50 px-3 py-2">
              <p className="text-[13px] text-muted-foreground break-words">
                {t('prop_per_sqm_derived')}
              </p>
              <p className="text-sm font-medium text-foreground break-words" dir="ltr">
                {derivedPerSqm ? `${currency}${derivedPerSqm}/m²` : '—'}
              </p>
            </div>
          </Section>

          {/* ── LOCATION ────────────────────────────────────────────────── */}
          <Section
            id="section-location"
            title={t('prop_section_location')}
            open={open.location}
            onToggle={() => toggle('location')}
          >
            <Field label={t('prop_field_city')} htmlFor="prop-city">
              <Input
                id="prop-city"
                value={city}
                onChange={(event) => setCity(event.target.value)}
                className="h-9 text-sm"
              />
            </Field>
            <Field label={t('prop_field_district')} htmlFor="prop-district">
              <Input
                id="prop-district"
                value={district}
                onChange={(event) => setDistrict(event.target.value)}
                className="h-9 text-sm"
              />
            </Field>
            <Field label={t('prop_field_address')} htmlFor="prop-address">
              <Input
                id="prop-address"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                className="h-9 text-sm"
              />
            </Field>
            {/*
              WHO MAY SEE THE ADDRESS is the owner's decision and the column already
              exists. Defaulting to CITY_ONLY rather than FULL: an address is the one
              field on this form that identifies a home somebody lives in.
            */}
            <Field
              label={t('prop_field_address_visibility')}
              htmlFor="prop-address-visibility"
              hint={t('prop_field_address_visibility_hint')}
            >
              <Select value={addressVisibility} onValueChange={setAddressVisibility}>
                <SelectTrigger id="prop-address-visibility" className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ADDRESS_VISIBILITY.map((level) => (
                    <SelectItem key={level} value={level} className="text-sm">
                      {t(`prop_addr_${level.toLowerCase()}` as never)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </Section>

          {/* ── DESCRIPTION ─────────────────────────────────────────────── */}
          <Section
            id="section-description"
            title={t('prop_section_description')}
            open={open.description}
            onToggle={() => toggle('description')}
          >
            <textarea
              id="prop-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={6}
              className="w-full min-h-[9rem] resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary break-words"
              placeholder={t('prop_field_description_placeholder')}
            />
            {imported && Boolean(facts?.original_description) && (
              <div className="rounded-lg border border-border/50 bg-background/50 px-3 py-2 space-y-1">
                <p className="text-[13px] font-medium text-muted-foreground break-words">
                  {t('prop_original_description')}
                </p>
                <p className="text-[13px] text-muted-foreground/70 break-words whitespace-pre-wrap max-h-40 overflow-y-auto">
                  {String(facts?.original_description)}
                </p>
              </div>
            )}
          </Section>

          {/* ── PHOTOS ──────────────────────────────────────────────────── */}
          <Section
            id="section-photos"
            title={t('prop_section_photos')}
            open={open.photos}
            onToggle={() => toggle('photos')}
          >
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif,image/heic"
              multiple
              hidden
              onChange={(event) => { void addPhotos(event.target.files); event.target.value = ''; }}
            />
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileInput.current?.click()}
                disabled={uploading > 0}
              >
                {uploading > 0
                  ? <Loader2 className="h-4 w-4 me-1.5 animate-spin shrink-0" />
                  : <Upload className="h-4 w-4 me-1.5 shrink-0" />}
                <span className="break-words">
                  {uploading > 0 ? t('prop_photo_uploading') : t('prop_photo_add')}
                </span>
              </Button>
              <span className="text-[13px] text-muted-foreground break-words min-w-0">
                {t('prop_photo_count', { count: String(photos.length) })}
              </span>
            </div>

            {photos.length === 0 && (
              <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center space-y-1.5">
                <ImageOff className="h-7 w-7 mx-auto opacity-30" />
                <p className="text-[13px] text-muted-foreground break-words">
                  {t('prop_photo_empty')}
                </p>
              </div>
            )}

            {photos.length > 0 && (
              <ul className="space-y-2">
                {photos.map((photo, index) => (
                  <li
                    key={String(photo.id)}
                    className="flex items-center gap-2 rounded-lg border border-border/60 p-2 min-w-0"
                  >
                    <div className="h-14 w-20 shrink-0 overflow-hidden rounded bg-secondary/40">
                      <PrivateImage
                        src={photo.storage_path ?? photo.public_url}
                        alt={String(photo.original_filename ?? t('prop_photo_alt'))}
                        className="h-full w-full object-cover"
                        pending={<div className="h-full w-full animate-pulse bg-secondary/60" />}
                        /* A thumbnail that cannot load says so, rather than shimmering
                           next to a row the owner is trying to reorder. */
                        fallback={(
                          <div className="flex h-full w-full items-center justify-center text-muted-foreground/40">
                            <ImageOff className="h-5 w-5" />
                          </div>
                        )}
                      />
                    </div>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="text-[13px] text-foreground break-words [overflow-wrap:anywhere]">
                        {String(photo.original_filename ?? `#${index + 1}`)}
                      </p>
                      {photo.is_cover && (
                        <Badge variant="secondary" className="gap-1 whitespace-normal">
                          <Star className="h-3 w-3 shrink-0" />
                          <span className="break-words">{t('prop_photo_cover')}</span>
                        </Badge>
                      )}
                    </div>
                    {/*
                      ARROWS, NOT DRAG HANDLES. A drag target is the least reliable
                      interaction on a touchscreen and this list is managed on phones.
                    */}
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        disabled={index === 0}
                        onClick={() => { void move(index, -1); }}
                      >
                        <ChevronUp className="h-4 w-4" />
                        <span className="sr-only">{t('prop_photo_move_up')}</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        disabled={index === photos.length - 1}
                        onClick={() => { void move(index, 1); }}
                      >
                        <ChevronDown className="h-4 w-4" />
                        <span className="sr-only">{t('prop_photo_move_down')}</span>
                      </Button>
                      {!photo.is_cover && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          onClick={() => { void setCover(String(photo.id)); }}
                        >
                          <Star className="h-4 w-4" />
                          <span className="sr-only">{t('prop_photo_make_cover')}</span>
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                        onClick={() => { void drop(photo); }}
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">{t('prop_photo_remove')}</span>
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {invalid.length > 0 && (
            <Card className="bg-card border-border">
              <CardContent className="p-3">
                <ul className="space-y-0.5">
                  {invalid.map((problem) => (
                    <li key={problem} className="flex items-start gap-1.5 text-[13px] text-muted-foreground min-w-0">
                      <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
                      <span className="break-words min-w-0">{problem}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>

        {/*
          THE SAVE BAR IS FIXED, and safe-area aware. A form of five collapsible
          sections can be taller than the viewport, and a save button at the bottom of
          it is a button somebody has to go looking for after every edit.
        */}
        <div
          className="fixed bottom-0 inset-x-0 z-40 border-t border-border bg-card/95 backdrop-blur md:bottom-0"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <div className="max-w-2xl mx-auto flex items-center gap-2 px-4 pt-3 flex-wrap">
            <Button
              onClick={() => { void save(); }}
              disabled={saving || invalid.length > 0}
              className="flex-1 min-w-[10rem]"
            >
              {saving
                ? <Loader2 className="h-4 w-4 me-1.5 animate-spin shrink-0" />
                : <Save className="h-4 w-4 me-1.5 shrink-0" />}
              <span className="break-words">{t('prop_save')}</span>
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate(`/property/${id}`)}
              className="shrink-0"
            >
              <span className="break-words">{t('prop_action_view')}</span>
            </Button>
          </div>
        </div>
      </AppLayout>
    </RouteGuard>
  );
}
