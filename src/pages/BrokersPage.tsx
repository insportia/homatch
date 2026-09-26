// src/pages/BrokersPage.tsx — BROKERS AND AGENCIES.
//
// THIS PAGE EXISTS TO MAKE ONE DISTINCTION IMPOSSIBLE TO MISS.
//
//   A LISTED BROKER registered with Homatch and pays to appear. We know who they
//   are because they told us.
//
//   AN OBSERVED FIRM is one whose name we read off a public listing while
//   discovering property. They have no relationship with Homatch, never asked to
//   be here, and are never presented as registered.
//
// Both are real and useful. Confusing them is not a cosmetic problem: telling
// somebody that a company we scraped is a Homatch partner is a claim about a
// commercial relationship that does not exist, and it is the kind of claim a
// customer would act on.
//
// SO THE DIRECTORY IS READ FROM A VIEW, NOT A TABLE.
//
// `broker_directory_public` emits only registrations that are ACTIVE with a
// paid_until still in the future. The discovered firms live in
// `broker_intelligence`, which this page does not query at all — it has no
// paid, verified or plan column to misread, and there is no route from it to
// this list. A firm reaches this page by registering and paying, or not at all.
//
// WHY THE EMPTY STATE SAYS SOMETHING RATHER THAN NOTHING
//
// Nobody has registered yet, so the directory is empty — and an empty directory
// is exactly where the temptation to "helpfully" fill it with the agencies we
// already know about would bite. The empty state says why it is empty, which is
// the honest version of the same information and does not imply a roster we do
// not have.
//
// WHERE OBSERVED FIRMS DO APPEAR
//
// On your own results, from find-property, labelled with what they are and with
// the provenance behind them: how many sources we saw them on, how many listings
// are attributed to them, and when we last actually saw them. Not on this page,
// because this page is the directory and they are not in it.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, Globe, Info, MapPin, Phone, ShieldCheck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { AppLayout } from '@/components/layouts/AppLayout';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/db/supabase';

interface DirectoryRow {
  id: string;
  display_name: string;
  role: string;
  cities: string[] | null;
  languages: string[] | null;
  contact_phone: string | null;
  website: string | null;
  paid_until: string | null;
}

/**
 * One registration.
 *
 * The badge here says "listed with Homatch" and it is the only badge on the page,
 * because a row in this list is the only thing that earns it.
 */
function DirectoryCard({ row }: { row: DirectoryRow }) {
  const { t } = useLanguage();
  const roleLabel = row.role === 'AGENCY' ? t('broker_role_agency') : t('broker_role_broker');
  const cities = (row.cities ?? []).filter(Boolean);
  const languages = (row.languages ?? []).filter(Boolean);

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 space-y-1">
            <h3 className="text-base font-semibold text-foreground break-words">
              {row.display_name}
            </h3>
            <p className="text-sm text-muted-foreground break-words">{roleLabel}</p>
          </div>
          <Badge className="shrink-0 whitespace-normal gap-1">
            <ShieldCheck className="h-3 w-3 shrink-0" />
            <span className="break-words">{t('broker_disclosure_directory')}</span>
          </Badge>
        </div>

        {cities.length > 0 && (
          <div className="flex items-start gap-1.5 text-sm text-muted-foreground min-w-0">
            <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="break-words min-w-0">{cities.join(', ')}</span>
          </div>
        )}
        {languages.length > 0 && (
          <div className="flex items-start gap-1.5 text-sm text-muted-foreground min-w-0">
            <Globe className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="break-words min-w-0">{languages.join(', ')}</span>
          </div>
        )}
        {row.contact_phone && (
          <div className="flex items-start gap-1.5 text-sm text-foreground min-w-0">
            <Phone className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="break-words min-w-0">{row.contact_phone}</span>
          </div>
        )}
        {row.website && (
          <a
            href={row.website.startsWith('http') ? row.website : `https://${row.website}`}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex items-start gap-1.5 text-sm text-primary hover:underline min-w-0"
          >
            <Globe className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="break-words min-w-0">{row.website}</span>
          </a>
        )}
      </CardContent>
    </Card>
  );
}

export default function BrokersPage() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<DirectoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      /*
       * THE VIEW, NOT THE TABLE. broker_directory_public applies the
       * ACTIVE-and-currently-paid test in one place so this screen cannot forget
       * it, and it cannot reach a discovered firm at all.
       */
      const { data } = await supabase
        .from('broker_directory_public')
        .select('id,display_name,role,cities,languages,contact_phone,website,paid_until')
        .order('display_name', { ascending: true })
        .limit(200);
      setRows((data ?? []) as unknown as DirectoryRow[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const empty = useMemo(() => !loading && rows.length === 0, [loading, rows.length]);

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl font-bold text-foreground break-words">
            {t('broker_page_title')}
          </h1>
          <p className="text-sm text-muted-foreground break-words">
            {t('broker_page_subtitle')}
          </p>
        </div>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-foreground break-words">
            {t('broker_directory_heading')}
          </h2>

          {loading && (
            <div className="space-y-3">
              <Skeleton className="h-32 rounded-xl" />
              <Skeleton className="h-32 rounded-xl" />
            </div>
          )}

          {empty && (
            <Card className="bg-card border-border">
              <CardContent className="p-5 text-center space-y-2">
                <Building2 className="h-9 w-9 mx-auto opacity-30" />
                <p className="text-sm font-medium text-foreground break-words">
                  {t('broker_directory_empty_title')}
                </p>
                <p className="text-sm text-muted-foreground break-words">
                  {t('broker_directory_empty_body')}
                </p>
              </CardContent>
            </Card>
          )}

          {rows.map((row) => <DirectoryCard key={row.id} row={row} />)}
        </section>

        {/*
          * THE DISTINCTION, STATED IN WORDS AND NOT ONLY IMPLIED BY LAYOUT.
          *
          * A customer who sees an observed agency on their results needs to already
          * know what that label means, and a tooltip on the results screen is not
          * where somebody learns it. So it is written out here, once, in all six
          * languages.
          */}
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-foreground break-words">
            {t('broker_distinction_heading')}
          </h2>
          <Card className="bg-card border-border">
            <CardContent className="p-4 space-y-4">
              <div className="flex items-start gap-2 min-w-0">
                <ShieldCheck className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium text-foreground break-words">
                    {t('broker_disclosure_directory')}
                  </p>
                  <p className="text-sm text-muted-foreground break-words">
                    {t('broker_distinction_directory')}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2 min-w-0">
                <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium text-foreground break-words">
                    {t('broker_disclosure_observed')}
                  </p>
                  <p className="text-sm text-muted-foreground break-words">
                    {t('broker_distinction_observed')}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <p className="text-sm text-muted-foreground break-words">
            {t('broker_register_cta')}
          </p>
        </section>
      </div>
    </AppLayout>
  );
}
