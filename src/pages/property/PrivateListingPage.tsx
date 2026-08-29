// Private listing creation — 7-step progressive form
import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { AppLayout } from '@/components/layouts/AppLayout';
import { RouteGuard } from '@/components/common/RouteGuard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import {
  createProperty, upsertPropertyFacts, addPropertyPhoto,
  uploadPropertyPhoto, createSearchProfile,
  logActivity, updateProperty,
} from '@/services/api';
import type { PropertyFacts } from '@/types/types';
import { GE_LOCATIONS } from '@/types/types';
import {
  ArrowLeft, ArrowRight, Upload, X, Star, Lock,
  CheckCircle2, Building2, AlertCircle,
} from 'lucide-react';

const MAX_PHOTOS = 5;

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7;

interface PhotoItem {
  file: File;
  previewUrl: string;
  isCover: boolean;
}

interface FormState {
  title: string;
  transactionType: string;
  propertyType: string;
  country: string;
  city: string;
  district: string;
  neighborhood: string;
  address: string;
  totalPrice: string;
  pricePerSqm: string;
  currency: string;
  area: string;
  rooms: string;
  bedrooms: string;
  bathrooms: string;
  floor: string;
  totalFloors: string;
  newBuild: boolean;
  condition: string;
  buildingType: string;
  parking: boolean;
  balcony: boolean;
  elevator: boolean;
  security: boolean;
  furnished: boolean;
  ac: boolean;
  description: string;
  photoVisibility: string;
  addressVisibility: string;
}

const initialForm: FormState = {
  title: '', transactionType: 'SALE', propertyType: 'APARTMENT',
  country: 'GE', city: '', district: '', neighborhood: '', address: '',
  totalPrice: '', pricePerSqm: '', currency: 'USD',
  area: '', rooms: '', bedrooms: '', bathrooms: '', floor: '', totalFloors: '',
  newBuild: false, condition: '', buildingType: '',
  parking: false, balcony: false, elevator: false, security: false, furnished: false, ac: false,
  description: '',
  photoVisibility: 'PRIVATE', addressVisibility: 'CITY_ONLY',
};

function StepIndicator({ current, total }: { current: Step; total: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-1 rounded-full transition-all ${
            i + 1 < current ? 'bg-primary flex-1' :
            i + 1 === current ? 'bg-primary flex-1' :
            'bg-secondary flex-[0.4]'
          }`}
        />
      ))}
    </div>
  );
}

function PrivateListingContent() {
  const { homatchUser } = useAuth();
  const { t, isRTL } = useLanguage();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormState>(initialForm);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [lastPriceField, setLastPriceField] = useState<'total' | 'sqm' | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const set = (key: keyof FormState, value: string | boolean) =>
    setForm(f => ({ ...f, [key]: value }));

  const cityDistricts = GE_LOCATIONS.find(l => l.city === form.city)?.districts ?? [];

  // Bidirectional price calculation — always sets raw string to preserve decimals
  const handleTotalPrice = (val: string) => {
    set('totalPrice', val);
    setLastPriceField('total');
    const total = parseFloat(val);
    const area = parseFloat(form.area);
    if (isFinite(total) && total > 0 && isFinite(area) && area > 0) {
      set('pricePerSqm', String(Math.round((total / area) * 100) / 100));
    }
  };
  const handlePricePerSqm = (val: string) => {
    set('pricePerSqm', val);
    setLastPriceField('sqm');
    const sqm = parseFloat(val);
    const area = parseFloat(form.area);
    if (isFinite(sqm) && sqm > 0 && isFinite(area) && area > 0) {
      set('totalPrice', String(Math.round(sqm * area * 100) / 100));
    }
  };
  const handleArea = (val: string) => {
    set('area', val);
    const area = parseFloat(val);
    if (!isFinite(area) || area <= 0) return;
    if (lastPriceField === 'total') {
      const total = parseFloat(form.totalPrice);
      if (isFinite(total) && total > 0) set('pricePerSqm', String(Math.round((total / area) * 100) / 100));
    } else {
      const sqm = parseFloat(form.pricePerSqm);
      if (isFinite(sqm) && sqm > 0) set('totalPrice', String(Math.round(sqm * area * 100) / 100));
    }
  };

  // Photo upload
  const handlePhotoUpload = useCallback((files: FileList | null) => {
    if (!files) return;
    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) {
      toast.error(`Maximum ${MAX_PHOTOS} photos allowed.`);
      return;
    }
    const newPhotos: PhotoItem[] = [];
    Array.from(files).slice(0, remaining).forEach(file => {
      if (!file.type.startsWith('image/')) return;
      newPhotos.push({
        file,
        previewUrl: URL.createObjectURL(file),
        isCover: photos.length === 0 && newPhotos.length === 0,
      });
    });
    if (Array.from(files).length > remaining) {
      toast.warning(`Only ${remaining} more photos allowed. Extra files were skipped.`);
    }
    setPhotos(prev => [...prev, ...newPhotos]);
  }, [photos]);

  const removePhoto = (idx: number) => {
    setPhotos(prev => {
      const next = prev.filter((_, i) => i !== idx);
      if (prev[idx].isCover && next.length > 0) next[0].isCover = true;
      return next;
    });
  };

  const setCover = (idx: number) => {
    setPhotos(prev => prev.map((p, i) => ({ ...p, isCover: i === idx })));
  };

  const validateStep7 = (): boolean => {
    const errs: Record<string, string> = {};
    if (!form.city) errs.city = 'Please select a city';
    if (!form.area) errs.area = 'Area is required';
    if (!form.totalPrice && !form.pricePerSqm) errs.price = 'At least one price field is required';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async () => {
    if (!homatchUser) return;
    if (!validateStep7()) return;
    if (saving) return;   // prevent duplicate submit
    setSaving(true);
    try {
      const propId = await createProperty({
        userId: homatchUser.id,
        sourceType: 'PRIVATE_LISTING',
        title: form.title || `Private ${form.propertyType.toLowerCase()} in ${form.city || 'Georgia'}`,
        transactionType: form.transactionType as any,
        propertyType: form.propertyType as any,
      });
      if (!propId) throw new Error('Failed to create property');

      const facts: Partial<PropertyFacts> = {
        property_id: propId,
        country: form.country || undefined,
        city: form.city || undefined,
        district: form.district || undefined,
        neighborhood: form.neighborhood || undefined,
        address: form.address || undefined,
        total_price: parseFloat(form.totalPrice) || undefined,
        price_per_sqm: parseFloat(form.pricePerSqm) || undefined,
        currency: form.currency,
        area: parseFloat(form.area) || undefined,
        rooms: parseInt(form.rooms) || undefined,
        bedrooms: parseInt(form.bedrooms) || undefined,
        bathrooms: parseInt(form.bathrooms) || undefined,
        floor: parseInt(form.floor) || undefined,
        total_floors: parseInt(form.totalFloors) || undefined,
        new_build: form.newBuild,
        condition: (form.condition as any) || undefined,
        building_type: (form.buildingType as any) || undefined,
        parking: form.parking,
        balcony: form.balcony,
        elevator: form.elevator,
        security: form.security,
        furnished: form.furnished,
        air_conditioning: form.ac,
        description: form.description || undefined,
        photo_visibility: form.photoVisibility as any,
        address_visibility: form.addressVisibility as any,
      };
      await upsertPropertyFacts({ ...facts, property_id: propId });
      await createSearchProfile(propId, homatchUser.id, facts);

      // Upload photos
      let coverUrl: string | undefined;
      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        try {
          const pubUrl = await uploadPropertyPhoto(homatchUser.id, propId, photo.file);
          await addPropertyPhoto({
            property_id: propId,
            storage_path: pubUrl,
            public_url: pubUrl,
            display_order: i,
            is_cover: photo.isCover,
            visibility: form.photoVisibility as any,
            original_filename: photo.file.name,
            file_size: photo.file.size,
          });
          if (photo.isCover) coverUrl = pubUrl;
        } catch (e) {
          console.error('Photo upload error:', e);
        }
      }
      if (coverUrl) await updateProperty(propId, { cover_photo_url: coverUrl });

      await logActivity(homatchUser.id, 'PRIVATE_LISTING_CREATED', propId);
      toast.success('Private listing created!');
      navigate(`/property/${propId}`);
    } catch (err: any) {
      console.error('[PrivateListing] save error:', err);
      const msg: string =
        err?.message?.includes('violates foreign key')
          ? 'User account not found. Please sign out and back in.'
          : err?.message?.includes('violates not-null constraint')
          ? 'A required field is missing. Please review your listing.'
          : err?.message?.includes('invalid input value for enum')
          ? 'An invalid option was selected. Please review your listing.'
          : err?.message?.includes('JWT')
          ? 'Your session has expired. Please sign in again.'
          : err?.message ?? 'Failed to create listing. Please try again.';
      toast.error(msg);
    } finally {
      // Always clear saving — prevents infinite spinner on success AND error paths
      setSaving(false);
    }
  };

  const stepLabels: string[] = [
    t('private_step_property'), t('private_step_location'), t('private_step_price'),
    t('private_step_details'), t('private_step_photos'), t('private_step_privacy'),
    t('private_step_review'),
  ];

  return (
    <AppLayout>
      <div className="max-w-xl mx-auto space-y-6">
        {/* Header */}
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <span className="status-private">{t('prop_private_badge')}</span>
            <h1 className="text-lg font-semibold text-foreground">{t('private_title')}</h1>
          </div>
          <p className="text-sm text-muted-foreground">{t('private_subtitle')}</p>
        </div>

        {/* Step indicator */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              {stepLabels[step - 1]}
            </span>
            <span className="text-xs text-muted-foreground/60">{step} / 7</span>
          </div>
          <StepIndicator current={step} total={7} />
        </div>

        {/* Step forms */}
        <div className="rounded-xl border border-border bg-card p-5" dir={isRTL ? 'rtl' : 'ltr'}>

          {/* Step 1: Property basics */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>{t('form_title')}</Label>
                <Input
                  value={form.title}
                  onChange={e => set('title', e.target.value)}
                  placeholder={t('form_title_placeholder')}
                  className="bg-secondary border-border"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{t('form_transaction_type')}</Label>
                  <Select value={form.transactionType} onValueChange={v => set('transactionType', v)}>
                    <SelectTrigger className="bg-secondary border-border h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      <SelectItem value="SALE">{t('prop_transaction_sale')}</SelectItem>
                      <SelectItem value="RENT">{t('prop_transaction_rent')}</SelectItem>
                      <SelectItem value="INVESTMENT">{t('prop_transaction_investment')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t('form_property_type')}</Label>
                  <Select value={form.propertyType} onValueChange={v => set('propertyType', v)}>
                    <SelectTrigger className="bg-secondary border-border h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      {['APARTMENT','HOUSE','VILLA','COMMERCIAL','LAND','STUDIO','PENTHOUSE','OTHER'].map(v => (
                        <SelectItem key={v} value={v}>{v.charAt(0) + v.slice(1).toLowerCase()}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Location */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{t('form_city')}</Label>
                  <Select value={form.city || 'none'} onValueChange={v => { set('city', v === 'none' ? '' : v); set('district', ''); }}>
                    <SelectTrigger className="bg-secondary border-border h-10">
                      <SelectValue placeholder="Select city" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      <SelectItem value="none">—</SelectItem>
                      {GE_LOCATIONS.map(l => <SelectItem key={l.city} value={l.city}>{l.city}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t('form_district')}</Label>
                  <Select
                    value={form.district || 'none'}
                    onValueChange={v => set('district', v === 'none' ? '' : v)}
                    disabled={!form.city || cityDistricts.length === 0}
                  >
                    <SelectTrigger className="bg-secondary border-border h-10">
                      <SelectValue placeholder="Select district" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      <SelectItem value="none">—</SelectItem>
                      {cityDistricts.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{t('form_neighborhood')} <span className="text-muted-foreground text-xs">({t('form_optional')})</span></Label>
                <Input value={form.neighborhood} onChange={e => set('neighborhood', e.target.value)} className="bg-secondary border-border" />
              </div>
              <div className="space-y-1.5">
                <Label>{t('form_address')} <span className="text-muted-foreground text-xs">({t('form_optional')})</span></Label>
                <Input value={form.address} onChange={e => set('address', e.target.value)} className="bg-secondary border-border" />
              </div>
            </div>
          )}

          {/* Step 3: Price & Size */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>{t('form_total_price')}</Label>
                  <Input type="number" value={form.totalPrice} onChange={e => handleTotalPrice(e.target.value)} className="bg-secondary border-border" placeholder="0" min="0" step="0.01" inputMode="decimal" />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('form_price_sqm')}</Label>
                  <Input type="number" value={form.pricePerSqm} onChange={e => handlePricePerSqm(e.target.value)} className="bg-secondary border-border" placeholder="0" min="0" step="0.01" inputMode="decimal" />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('form_currency')}</Label>
                  <Select value={form.currency} onValueChange={v => set('currency', v)}>
                    <SelectTrigger className="bg-secondary border-border h-10"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="GEL">GEL</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>{t('form_area')}</Label>
                  <Input type="number" value={form.area} onChange={e => handleArea(e.target.value)} className="bg-secondary border-border" placeholder="m²" min="0" step="0.01" inputMode="decimal" />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('form_bedrooms')}</Label>
                  <Input type="number" value={form.bedrooms} onChange={e => set('bedrooms', e.target.value)} className="bg-secondary border-border" min="0" max="20" step="1" inputMode="numeric" />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('form_bathrooms')}</Label>
                  <Input type="number" value={form.bathrooms} onChange={e => set('bathrooms', e.target.value)} className="bg-secondary border-border" min="0" max="10" step="1" inputMode="numeric" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{t('form_floor')}</Label>
                  <Input type="number" value={form.floor} onChange={e => set('floor', e.target.value)} className="bg-secondary border-border" step="1" inputMode="numeric" />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('form_total_floors')}</Label>
                  <Input type="number" value={form.totalFloors} onChange={e => set('totalFloors', e.target.value)} className="bg-secondary border-border" step="1" inputMode="numeric" />
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Details */}
          {step === 4 && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{t('form_condition')}</Label>
                  <Select value={form.condition || 'none'} onValueChange={v => set('condition', v === 'none' ? '' : v)}>
                    <SelectTrigger className="bg-secondary border-border h-10"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      <SelectItem value="none">—</SelectItem>
                      <SelectItem value="NEW">New</SelectItem>
                      <SelectItem value="GOOD">Good</SelectItem>
                      <SelectItem value="NEEDS_RENOVATION">Needs renovation</SelectItem>
                      <SelectItem value="UNDER_CONSTRUCTION">Under construction</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t('form_building_type')}</Label>
                  <Select value={form.buildingType || 'none'} onValueChange={v => set('buildingType', v === 'none' ? '' : v)}>
                    <SelectTrigger className="bg-secondary border-border h-10"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      <SelectItem value="none">—</SelectItem>
                      <SelectItem value="PANEL">Panel</SelectItem>
                      <SelectItem value="BRICK">Brick</SelectItem>
                      <SelectItem value="MONOLITH">Monolith</SelectItem>
                      <SelectItem value="WOOD">Wood</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Amenity toggles */}
              <div className="space-y-3">
                {([
                  ['newBuild', t('form_new_build')],
                  ['parking', t('form_parking')],
                  ['balcony', t('form_balcony')],
                  ['elevator', t('form_elevator')],
                  ['security', t('form_security')],
                  ['furnished', t('form_furnished')],
                  ['ac', t('form_ac')],
                ] as [keyof FormState, string][]).map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between py-1">
                    <Label className="text-sm cursor-pointer">{label}</Label>
                    <Switch
                      checked={!!form[key]}
                      onCheckedChange={v => set(key, v)}
                    />
                  </div>
                ))}
              </div>

              <div className="space-y-1.5">
                <Label>{t('form_description')}</Label>
                <Textarea
                  value={form.description}
                  onChange={e => set('description', e.target.value)}
                  placeholder={t('form_description_placeholder')}
                  className="bg-secondary border-border min-h-24 resize-none"
                />
              </div>
            </div>
          )}

          {/* Step 5: Photos */}
          {step === 5 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">{t('private_step_photos')}</Label>
                <span className="text-xs text-muted-foreground">{photos.length} / {MAX_PHOTOS}</span>
              </div>
              <p className="text-xs text-muted-foreground">{t('private_photos_hint')}</p>

              {/* Upload zone */}
              {photos.length < MAX_PHOTOS && (
                <label className="flex flex-col items-center justify-center border-2 border-dashed border-border rounded-xl p-8 cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-colors">
                  <Upload className="h-6 w-6 text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">{t('private_photos_upload')}</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">JPG, PNG, WebP · max 5MB each</p>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="sr-only"
                    onChange={e => handlePhotoUpload(e.target.files)}
                  />
                </label>
              )}

              {/* Photo grid */}
              {photos.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {photos.map((photo, idx) => (
                    <div key={idx} className="relative rounded-lg overflow-hidden aspect-square border border-border group">
                      <img
                        src={photo.previewUrl}
                        alt={`Photo ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                      {photo.isCover && (
                        <div className="absolute bottom-0 inset-x-0 text-[10px] font-medium bg-primary/90 text-primary-foreground text-center py-0.5">
                          Cover
                        </div>
                      )}
                      <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {!photo.isCover && (
                          <button
                            type="button"
                            onClick={() => setCover(idx)}
                            className="w-6 h-6 bg-background/80 rounded flex items-center justify-center hover:bg-primary hover:text-primary-foreground"
                            title="Set as cover"
                          >
                            <Star className="h-3 w-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => removePhoto(idx)}
                          className="w-6 h-6 bg-background/80 rounded flex items-center justify-center hover:bg-destructive hover:text-destructive-foreground"
                          title="Remove"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 6: Privacy */}
          {step === 6 && (
            <div className="space-y-5">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
                <Lock className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <p className="text-sm text-muted-foreground">
                  Your listing is private by default. Control who can see your photos and address.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>{t('private_photo_visibility')}</Label>
                <Select value={form.photoVisibility} onValueChange={v => set('photoVisibility', v)}>
                  <SelectTrigger className="bg-secondary border-border h-10"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="PRIVATE">{t('private_visibility_private')}</SelectItem>
                    <SelectItem value="AUTHENTICATED">{t('private_visibility_auth')}</SelectItem>
                    <SelectItem value="PUBLIC">{t('private_visibility_public')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>{t('private_address_visibility')}</Label>
                <Select value={form.addressVisibility} onValueChange={v => set('addressVisibility', v)}>
                  <SelectTrigger className="bg-secondary border-border h-10"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="CITY_ONLY">{t('private_address_city')}</SelectItem>
                    <SelectItem value="FULL">{t('private_address_full')}</SelectItem>
                    <SelectItem value="HIDDEN">{t('private_address_hidden')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Step 7: Review */}
          {step === 7 && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-foreground">Review your listing</h3>

              {/* Field-level errors banner */}
              {Object.keys(fieldErrors).length > 0 && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30">
                  <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <div className="text-xs text-destructive space-y-0.5">
                    {Object.values(fieldErrors).map((msg, i) => (
                      <p key={i}>{msg}</p>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2 text-sm">
                {[
                  ['Title', form.title || <span className="text-muted-foreground/50">—</span>],
                  ['Type', `${form.transactionType} · ${form.propertyType}`],
                  ['Location', [form.city, form.district].filter(Boolean).join(', ') || <span className="text-destructive text-xs">Required</span>],
                  ['Price', form.totalPrice ? `${form.totalPrice} ${form.currency}` : (!form.pricePerSqm ? <span className="text-destructive text-xs">Required</span> : `${form.pricePerSqm} ${form.currency}/m²`)],
                  ['Area', form.area ? `${form.area} m²` : <span className="text-destructive text-xs">Required</span>],
                  ['Bedrooms', form.bedrooms || '—'],
                  ['Photos', `${photos.length} / ${MAX_PHOTOS}`],
                  ['Privacy', form.photoVisibility],
                ].map(([label, value]) => (
                  <div key={String(label)} className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-medium text-foreground">{value}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-2 p-3 rounded-lg bg-primary/5 border border-primary/20">
                <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                <p className="text-xs text-muted-foreground">
                  Your listing will be created privately. Homatch will start building your search profile.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Nav buttons */}
        <div className="flex items-center gap-3">
          {step > 1 && (
            <Button
              variant="ghost"
              onClick={() => setStep(s => (s - 1) as Step)}
              className="border border-border gap-1.5"
              disabled={saving}
            >
              <ArrowLeft className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} />
              {t('private_back')}
            </Button>
          )}
          {step < 7 ? (
            <Button
              onClick={() => setStep(s => (s + 1) as Step)}
              className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold gap-1.5"
            >
              {t('private_next')}
              <ArrowRight className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={saving}
              className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
            >
              {saving ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  Creating…
                </span>
              ) : t('private_submit')}
            </Button>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

export default function PrivateListingPage() {
  return (
    <RouteGuard>
      <PrivateListingContent />
    </RouteGuard>
  );
}
