import React, { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';

// Verified working root URLs for major Georgian real-estate sites (checked
// against live search results). This is the fallback whenever we don't have
// a verified deep link for the property's specific district/transaction —
// a wrong guessed deep link is worse than a plain one, so we never construct
// one we haven't confirmed actually exists.
const EXTERNAL_SITES_DEFAULT: Array<{ name: string; url: string }> = [
  { name: 'MyHome.ge', url: 'https://www.myhome.ge/en/' },
  { name: 'SS.ge', url: 'https://home.ss.ge/en/real-estate' },
  { name: 'Livo.ge', url: 'https://livo.ge/en' },
  { name: 'Korter.ge', url: 'https://korter.ge/en/' },
];

// Korter.ge uses real, but inconsistent, per-district URL slugs (e.g. sale
// pages sometimes add a "-district" suffix, rent pages usually don't) — each
// entry below was confirmed via live web search, not guessed. Georgian
// district names map to whichever canonical key we've verified; anything
// not in this table falls back to the generic Korter.ge homepage link.
const KORTER_TBILISI_DISTRICTS: Record<string, { sale?: string; rent?: string }> = {
  varketili: {
    sale: 'https://korter.ge/en/apartments-sale-tbilisi-varketili',
    rent: 'https://korter.ge/en/apartments-for-rent-tbilisi-varketili',
  },
  vake: {
    sale: 'https://korter.ge/en/apartments-sale-tbilisi-vake-district',
    rent: 'https://korter.ge/en/apartments-for-rent-tbilisi-vake',
  },
  saburtalo: { sale: 'https://korter.ge/en/apartments-sale-tbilisi-saburtalo-district' },
  krtsanisi: { sale: 'https://korter.ge/en/apartments-sale-tbilisi-krtsanisi-district' },
  samgori: {
    sale: 'https://korter.ge/en/apartments-sale-tbilisi-samgori-district',
    rent: 'https://korter.ge/en/apartments-for-rent-tbilisi-samgori',
  },
  nadzaladevi: {
    sale: 'https://korter.ge/en/apartments-sale-tbilisi-nadzaladevi-district',
    rent: 'https://korter.ge/en/apartments-for-rent-tbilisi-nadzaladevi',
  },
  isani: { sale: 'https://korter.ge/en/apartments-sale-tbilisi-isani-district' },
  didube: { rent: 'https://korter.ge/en/apartments-for-rent-tbilisi-didube' },
  digomi: { rent: 'https://korter.ge/en/apartments-for-rent-tbilisi-digomi' },
  'didi dighomi': { rent: 'https://korter.ge/en/apartments-for-rent-tbilisi-didi-dighomi' },
};

// Georgian-script + common Latin-transliteration aliases for the districts
// above, so a district value scraped in either script still resolves.
const DISTRICT_ALIASES: Record<string, string> = {
  'ვარკეთილი': 'varketili', 'varketili': 'varketili',
  'ვაკე': 'vake', 'vake': 'vake',
  'საბურთალო': 'saburtalo', 'saburtalo': 'saburtalo',
  'კრწანისი': 'krtsanisi', 'krtsanisi': 'krtsanisi',
  'სამგორი': 'samgori', 'samgori': 'samgori',
  'ნაძალადევი': 'nadzaladevi', 'nadzaladevi': 'nadzaladevi',
  'ისანი': 'isani', 'isani': 'isani',
  'დიდუბე': 'didube', 'didube': 'didube',
  'დიღომი': 'digomi', 'digomi': 'digomi', 'dighomi massive': 'digomi',
  'დიდი დიღომი': 'didi dighomi', 'didi dighomi': 'didi dighomi',
};

function buildKorterUrl(city?: string | null, district?: string | null, transactionType?: string | null): string | null {
  if (!city || city.toLowerCase() !== 'tbilisi') return null;
  if (!district) return null;
  const key = DISTRICT_ALIASES[district.trim().toLowerCase()];
  if (!key) return null;
  const entry = KORTER_TBILISI_DISTRICTS[key];
  if (!entry) return null;
  if (transactionType === 'SALE') return entry.sale ?? null;
  if (transactionType === 'RENT') return entry.rent ?? null;
  return null;
}

// SS.ge's iyideba/qiravdeba ("for sale"/"for rent") path segments are stable,
// human-readable Georgian real-estate terms (used across their own site
// navigation), not opaque numeric IDs — safe to construct without guessing,
// unlike their per-district filters which rely on internal numeric IDs we
// have no reliable way to map from a district name.
function buildSsGeUrl(transactionType?: string | null): string | null {
  if (transactionType === 'SALE') return 'https://home.ss.ge/ka/udzravi-qoneba/l/bina/iyideba';
  if (transactionType === 'RENT') return 'https://home.ss.ge/ka/udzravi-qoneba/l/bina/qiravdeba';
  return null;
}

export function ExternalSitesCard({ propertyId, className }: { propertyId?: string; className?: string }) {
  const { t } = useLanguage();
  const [sites, setSites] = useState(EXTERNAL_SITES_DEFAULT);

  useEffect(() => {
    if (!propertyId) return;
    let cancelled = false;
    (async () => {
      const { data: property } = await supabase.from('properties')
        .select('transaction_type,property_facts(city,district,neighborhood)')
        .eq('id', propertyId).maybeSingle();
      if (cancelled || !property) return;
      const facts = (property as { property_facts?: { city?: string | null; district?: string | null; neighborhood?: string | null } | null }).property_facts ?? null;
      const transactionType = (property as { transaction_type?: string | null }).transaction_type ?? null;
      const district = facts?.district ?? facts?.neighborhood ?? null;
      const korterUrl = buildKorterUrl(facts?.city, district, transactionType);
      const ssGeUrl = buildSsGeUrl(transactionType);
      setSites([
        { name: 'MyHome.ge', url: 'https://www.myhome.ge/en/' },
        { name: 'SS.ge', url: ssGeUrl ?? 'https://home.ss.ge/en/real-estate' },
        { name: 'Livo.ge', url: 'https://livo.ge/en' },
        { name: 'Korter.ge', url: korterUrl ?? 'https://korter.ge/en/' },
      ]);
    })();
    return () => { cancelled = true; };
  }, [propertyId]);

  return (
    <Card className={className}>
      <CardContent className="p-4">
        <p className="text-sm font-medium mb-0.5">{t('external_sites_title')}</p>
        <p className="text-xs text-muted-foreground mb-3">{t('external_sites_subtitle')}</p>
        <div className="flex flex-wrap gap-2">
          {sites.map((site) => (
            <a
              key={site.name}
              href={site.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-border bg-secondary/50 hover:bg-secondary transition-colors"
            >
              {site.name}
              <ExternalLink className="h-3 w-3 text-muted-foreground" />
            </a>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
