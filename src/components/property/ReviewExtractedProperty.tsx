// ReviewExtractedProperty — lets user confirm/edit extracted property details before saving
// v4: global free-text city/district, rooms field, extended currency, full snake_case mapping

import React, { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { PropertyFacts, TransactionType, PropertyType } from '@/types/types';
import { ExternalLink, Save, AlertCircle, ImageOff } from 'lucide-react';

/** Facts payload passed to onSave — includes property-level fields that
 *  live outside PropertyFacts but are needed by the caller. */
export interface ReviewSavePayload extends Partial<PropertyFacts> {
  transaction_type?: TransactionType;
  property_type?: PropertyType;
}

interface Props {
  facts: Partial<PropertyFacts>;
  title: string;
  sourceUrl?: string;
  isMock?: boolean;
  /** External saving state — when provided, disables submit while caller is persisting */
  saving?: boolean;
  onSave: (facts: ReviewSavePayload, title: string) => Promise<void>;
  onBack: () => void;
}

// Stored as raw string so decimal input (94.4) is never coerced
interface PriceState {
  totalPrice: string;
  pricePerSqm: string;
  area: string;
}

// Common ISO currencies for international listings
const CURRENCIES = ['USD', 'EUR', 'GBP', 'GEL', 'TRY', 'AED', 'ILS', 'KZT', 'UAH', 'CHF', 'PLN', 'SEK'];

function toPriceState(f: Partial<PropertyFacts>): PriceState {
  return {
    totalPrice: f.total_price != null ? String(f.total_price) : '',
    pricePerSqm: f.price_per_sqm != null ? String(f.price_per_sqm) : '',
    area: f.area != null ? String(f.area) : '',
  };
}

function safeNum(s: string): number | undefined {
  const n = parseFloat(s);
  return isFinite(n) && n > 0 ? n : undefined;
}
function round2(n: number): string {
  return String(Math.round(n * 100) / 100);
}

// Normalize EF response: handle both camelCase and snake_case field names,
// extract transaction_type / property_type from top-level or nested
function normalizeFacts(raw: Partial<PropertyFacts> & Record<string, unknown>): {
  facts: Partial<PropertyFacts>;
  transactionType: string;
  propertyType: string;
} {
  // EF returns snake_case; but guard against camelCase from any legacy path
  const f: Partial<PropertyFacts> & Record<string, unknown> = { ...raw };

  // Lift transaction_type / property_type — they are not in PropertyFacts DB schema
  // but EF includes them at the top level of the facts object
  const transactionType = String(
    (f as Record<string, unknown>).transaction_type ?? ''
  ).toUpperCase() || 'SALE';
  const propertyType = String(
    (f as Record<string, unknown>).property_type ?? ''
  ).toUpperCase() || 'APARTMENT';

  // Normalize camelCase → snake_case for any field that might arrive misnamed
  const camelToSnake: Record<string, keyof PropertyFacts> = {
    totalPrice:   'total_price',
    pricePerSqm:  'price_per_sqm',
    coverImage:   'cover_image',
    galleryImages:'gallery_images',
    totalFloors:  'total_floors',
    streetAddress:'address',
    sourceDomain: 'source_domain',
    sourceLanguage: 'source_language',
  };
  for (const [camel, snake] of Object.entries(camelToSnake)) {
    if (f[camel] !== undefined && f[snake] === undefined) {
      (f as Record<string, unknown>)[snake] = f[camel];
    }
  }

  // Parse numeric strings — EF may return string for decimal fields
  for (const key of ['total_price', 'price_per_sqm', 'area'] as const) {
    if (typeof f[key] === 'string') {
      const n = parseFloat(f[key] as string);
      if (isFinite(n)) (f as Record<string, unknown>)[key] = n;
    }
  }

  return { facts: f as Partial<PropertyFacts>, transactionType, propertyType };
}

export function ReviewExtractedProperty({
  facts: rawFacts, title: initialTitle, sourceUrl, isMock, saving: externalSaving, onSave, onBack,
}: Props) {
  const { t, isRTL } = useLanguage();

  // Normalize on first render
  const { facts: normalizedFacts, transactionType: initTxn, propertyType: initPT } = React.useMemo(
    () => normalizeFacts(rawFacts as Partial<PropertyFacts> & Record<string, unknown>),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [facts, setFacts] = useState<Partial<PropertyFacts>>(normalizedFacts);
  const [transactionType, setTransactionType] = useState<string>(initTxn);
  const [propertyType, setPropertyType] = useState<string>(initPT);
  const [title, setTitle] = useState(initialTitle);
  const [internalSaving, setInternalSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const saving = externalSaving || internalSaving;

  // Price fields as raw strings — never coerce decimal input
  const [prices, setPrices] = useState<PriceState>(() => toPriceState(normalizedFacts));
  const [lastPriceField, setLastPriceField] = useState<'total' | 'sqm' | null>(null);

  // Currency — if extracted value not in dropdown, still show it as free text
  const extractedCurrency = normalizedFacts.currency ?? 'USD';
  const [currency, setCurrency] = useState<string>(extractedCurrency);

  const handleTotalPrice = (val: string) => {
    setLastPriceField('total');
    const total = safeNum(val);
    const area = safeNum(prices.area);
    setPrices(p => ({
      ...p,
      totalPrice: val,
      pricePerSqm: total && area ? round2(total / area) : p.pricePerSqm,
    }));
    setErrors(e => { const n = { ...e }; delete n.totalPrice; return n; });
  };

  const handlePricePerSqm = (val: string) => {
    setLastPriceField('sqm');
    const sqm = safeNum(val);
    const area = safeNum(prices.area);
    setPrices(p => ({
      ...p,
      pricePerSqm: val,
      totalPrice: sqm && area ? round2(sqm * area) : p.totalPrice,
    }));
  };

  const handleArea = (val: string) => {
    const area = safeNum(val);
    setPrices(p => {
      const next: PriceState = { ...p, area: val };
      if (area) {
        if (lastPriceField === 'total') {
          const total = safeNum(p.totalPrice);
          if (total) next.pricePerSqm = round2(total / area);
        } else {
          const sqm = safeNum(p.pricePerSqm);
          if (sqm) next.totalPrice = round2(sqm * area);
        }
      }
      return next;
    });
    setErrors(e => { const n = { ...e }; delete n.area; return n; });
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!title.trim()) errs.title = 'Title is required';
    // City is now free-text — only require it's non-empty
    if (!facts.city?.trim()) errs.city = 'City is required';
    if (!prices.area) errs.area = 'Area is required';
    if (!prices.totalPrice && !prices.pricePerSqm) {
      errs.totalPrice = 'At least one price field is required';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate() || saving) return;
    setInternalSaving(true);
    try {
      await onSave({
        ...facts,
        total_price: safeNum(prices.totalPrice),
        price_per_sqm: safeNum(prices.pricePerSqm),
        area: safeNum(prices.area),
        currency,
        transaction_type: transactionType as TransactionType,
        property_type: propertyType as PropertyType,
      }, title);
    } finally {
      setInternalSaving(false);
    }
  };

  const missing = [
    !title.trim() && 'Title',
    !facts.city?.trim() && 'City',
    !prices.area && 'Area',
    !prices.totalPrice && !prices.pricePerSqm && 'Price',
  ].filter(Boolean);

  // Build gallery from normalized facts
  const gallery: string[] = facts.gallery_images?.length
    ? facts.gallery_images
    : facts.cover_image
      ? [facts.cover_image]
      : [];

  return (
    <form onSubmit={handleSubmit} className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>

      {/* Mock badge */}
      {isMock && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-500/10 border border-orange-500/30">
          <span className="text-xs font-bold text-orange-400 uppercase tracking-wide">{t('import_mock_badge')}</span>
          <span className="text-xs text-muted-foreground">— Demo data. Real import unavailable.</span>
        </div>
      )}

      {/* Missing fields hint */}
      {missing.length > 0 && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-secondary/60 border border-border">
          <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            {t('import_review_missing')}: <span className="text-foreground font-medium">{missing.join(', ')}</span>
          </p>
        </div>
      )}

      {/* Source URL */}
      {sourceUrl && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/50 border border-border">
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <a href={sourceUrl} target="_blank" rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-primary truncate min-w-0" dir="ltr">
            {sourceUrl}
          </a>
        </div>
      )}

      {/* Photo gallery strip */}
      {gallery.length === 0 ? (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/40 border border-border">
          <ImageOff className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
          <span className="text-xs text-muted-foreground/60">No listing photos extracted from source</span>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="rounded-lg overflow-hidden border border-border w-full bg-secondary" style={{ aspectRatio: '16/9', maxHeight: 200 }}>
            <img src={gallery[0]} alt="Cover photo" className="w-full h-full object-cover" />
          </div>
          {gallery.length > 1 && (
            <div className="flex gap-2 overflow-x-auto">
              {gallery.slice(1).map((imgUrl, i) => (
                <div key={i} className="rounded border border-border overflow-hidden shrink-0 bg-secondary" style={{ width: 72, height: 54 }}>
                  <img src={imgUrl} alt={`Photo ${i + 2}`} className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">{gallery.length} listing photo{gallery.length !== 1 ? 's' : ''} extracted</p>
        </div>
      )}

      {/* Title */}
      <div className="space-y-1.5">
        <Label className="text-sm font-medium">{t('form_title')}</Label>
        <Input
          value={title}
          onChange={e => { setTitle(e.target.value); setErrors(er => { const n = {...er}; delete n.title; return n; }); }}
          placeholder={t('form_title_placeholder')}
          className={`bg-secondary border-border ${errors.title ? 'border-destructive' : ''}`}
        />
        {errors.title && <p className="text-xs text-destructive">{errors.title}</p>}
      </div>

      {/* Transaction & Property type */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">{t('form_transaction_type')}</Label>
          <Select value={transactionType} onValueChange={setTransactionType}>
            <SelectTrigger className="bg-secondary border-border h-10"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-card border-border">
              <SelectItem value="SALE">{t('prop_transaction_sale')}</SelectItem>
              <SelectItem value="RENT">{t('prop_transaction_rent')}</SelectItem>
              <SelectItem value="INVESTMENT">{t('prop_transaction_investment')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">{t('form_property_type')}</Label>
          <Select value={propertyType} onValueChange={setPropertyType}>
            <SelectTrigger className="bg-secondary border-border h-10"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-card border-border">
              {['APARTMENT','HOUSE','VILLA','COMMERCIAL','LAND','STUDIO','PENTHOUSE','TOWNHOUSE','OTHER'].map(v => (
                <SelectItem key={v} value={v}>{v.charAt(0) + v.slice(1).toLowerCase()}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Location — global free-text fields (no dropdown restriction) */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Location</h3>
        <div className="grid grid-cols-2 gap-3">
          {/* Country — free-text */}
          <div className="space-y-1.5">
            <Label className="text-sm">Country</Label>
            <Input
              value={facts.country ?? ''}
              onChange={e => setFacts(f => ({ ...f, country: e.target.value || undefined }))}
              placeholder="e.g. Georgia, Turkey, UAE"
              className="bg-secondary border-border"
            />
          </div>
          {/* City — free-text; works for any global city */}
          <div className="space-y-1.5">
            <Label className="text-sm">{t('form_city')}</Label>
            <Input
              value={facts.city ?? ''}
              onChange={e => {
                setFacts(f => ({ ...f, city: e.target.value || undefined }));
                setErrors(er => { const n = {...er}; delete n.city; return n; });
              }}
              placeholder="e.g. Tbilisi, Istanbul, Dubai"
              className={`bg-secondary border-border ${errors.city ? 'border-destructive' : ''}`}
            />
            {errors.city && <p className="text-xs text-destructive">{errors.city}</p>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {/* District — free-text */}
          <div className="space-y-1.5">
            <Label className="text-sm">{t('form_district')}</Label>
            <Input
              value={facts.district ?? ''}
              onChange={e => setFacts(f => ({ ...f, district: e.target.value || undefined }))}
              placeholder="e.g. Krtsanisi, Beşiktaş"
              className="bg-secondary border-border"
            />
          </div>
          {/* Neighborhood */}
          <div className="space-y-1.5">
            <Label className="text-sm">Neighborhood</Label>
            <Input
              value={facts.neighborhood ?? ''}
              onChange={e => setFacts(f => ({ ...f, neighborhood: e.target.value || undefined }))}
              placeholder="e.g. Saburtalo"
              className="bg-secondary border-border"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm">{t('form_address')} <span className="text-muted-foreground">({t('form_optional')})</span></Label>
          <Input
            value={facts.address ?? ''}
            onChange={e => setFacts(f => ({ ...f, address: e.target.value || undefined }))}
            placeholder="Street address"
            className="bg-secondary border-border"
          />
        </div>
      </div>

      {/* Price & Size */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Price & Size</h3>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-sm">{t('form_total_price')}</Label>
            <Input
              type="number" step="0.01" min="0" inputMode="decimal"
              value={prices.totalPrice}
              onChange={e => handleTotalPrice(e.target.value)}
              className={`bg-secondary border-border ${errors.totalPrice ? 'border-destructive' : ''}`}
              placeholder="0"
            />
            {errors.totalPrice && <p className="text-xs text-destructive">{errors.totalPrice}</p>}
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">{t('form_price_sqm')}</Label>
            <Input
              type="number" step="0.01" min="0" inputMode="decimal"
              value={prices.pricePerSqm}
              onChange={e => handlePricePerSqm(e.target.value)}
              className="bg-secondary border-border"
              placeholder="0"
            />
          </div>
          {/* Currency — full ISO list; shows extracted value even if non-standard */}
          <div className="space-y-1.5">
            <Label className="text-sm">{t('form_currency')}</Label>
            <Select
              value={CURRENCIES.includes(currency) ? currency : 'OTHER'}
              onValueChange={v => { if (v !== 'OTHER') setCurrency(v); }}
            >
              <SelectTrigger className="bg-secondary border-border h-10">
                <SelectValue>{CURRENCIES.includes(currency) ? currency : currency}</SelectValue>
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                {!CURRENCIES.includes(currency) && (
                  <SelectItem value="OTHER">{currency}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-sm">{t('form_area')} (m²)</Label>
            <Input
              type="number" step="0.01" min="0" inputMode="decimal"
              value={prices.area}
              onChange={e => handleArea(e.target.value)}
              className={`bg-secondary border-border ${errors.area ? 'border-destructive' : ''}`}
              placeholder="m²"
            />
            {errors.area && <p className="text-xs text-destructive">{errors.area}</p>}
          </div>
          {/* Rooms — total room count */}
          <div className="space-y-1.5">
            <Label className="text-sm">Total Rooms</Label>
            <Input
              type="number" step="1" min="0" max="30" inputMode="numeric"
              value={facts.rooms ?? ''}
              onChange={e => setFacts(f => ({ ...f, rooms: parseInt(e.target.value) || undefined }))}
              className="bg-secondary border-border"
              placeholder="3"
            />
          </div>
          {/* Bedrooms — sleeping rooms */}
          <div className="space-y-1.5">
            <Label className="text-sm">{t('form_bedrooms')}</Label>
            <Input
              type="number" step="1" min="0" max="20" inputMode="numeric"
              value={facts.bedrooms ?? ''}
              onChange={e => setFacts(f => ({ ...f, bedrooms: parseInt(e.target.value) || undefined }))}
              className="bg-secondary border-border"
              placeholder="2"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-sm">Bathrooms</Label>
            <Input
              type="number" step="1" min="0" max="10" inputMode="numeric"
              value={facts.bathrooms ?? ''}
              onChange={e => setFacts(f => ({ ...f, bathrooms: parseInt(e.target.value) || undefined }))}
              className="bg-secondary border-border"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">{t('form_floor')}</Label>
            <Input
              type="number" step="1" inputMode="numeric"
              value={facts.floor ?? ''}
              onChange={e => setFacts(f => ({ ...f, floor: parseInt(e.target.value) || undefined }))}
              className="bg-secondary border-border"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Total Floors</Label>
            <Input
              type="number" step="1" inputMode="numeric"
              value={facts.total_floors ?? ''}
              onChange={e => setFacts(f => ({ ...f, total_floors: parseInt(e.target.value) || undefined }))}
              className="bg-secondary border-border"
            />
          </div>
        </div>
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <Label className="text-sm font-medium">{t('form_description')}</Label>
        <Textarea
          value={facts.description ?? ''}
          onChange={e => setFacts(f => ({ ...f, description: e.target.value || undefined }))}
          placeholder={t('form_description_placeholder')}
          className="bg-secondary border-border min-h-24 resize-none"
        />
      </div>

      {/* Diagnostic info — shown when source domain is known */}
      {facts.source_domain && (
        <div className="px-3 py-2 rounded-lg bg-secondary/30 border border-border/50 text-xs text-muted-foreground space-y-0.5">
          <p>Source: <span className="text-foreground">{facts.source_domain}</span>
            {facts.source_language ? ` · Language: ${facts.source_language.toUpperCase()}` : ''}</p>
          {facts.source_listing_id && <p>Listing ID: <span className="text-foreground">{facts.source_listing_id}</span></p>}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <Button type="button" variant="ghost" onClick={onBack} className="border border-border" disabled={saving}>
          {t('import_back_btn')}
        </Button>
        <Button
          type="submit"
          disabled={saving}
          className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
        >
          {saving ? (
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
              {t('import_saving')}
            </span>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              {t('import_save_btn')}
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
