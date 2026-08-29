import React from 'react';
import { ExternalLink } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';

// Verified working root URLs for major Georgian real-estate sites (checked
// against live search results). We deliberately link to each site's own
// real-estate section rather than guessing per-listing deep-link query
// params we can't verify — a wrong deep link is worse than a plain one.
const EXTERNAL_SITES: Array<{ name: string; url: string }> = [
  { name: 'MyHome.ge', url: 'https://www.myhome.ge/en/' },
  { name: 'SS.ge', url: 'https://home.ss.ge/en/real-estate' },
  { name: 'Livo.ge', url: 'https://livo.ge/en' },
  { name: 'Korter.ge', url: 'https://korter.ge/en/' },
];

export function ExternalSitesCard({ className }: { className?: string }) {
  const { t } = useLanguage();
  return (
    <Card className={className}>
      <CardContent className="p-4">
        <p className="text-sm font-medium mb-0.5">{t('external_sites_title')}</p>
        <p className="text-xs text-muted-foreground mb-3">{t('external_sites_subtitle')}</p>
        <div className="flex flex-wrap gap-2">
          {EXTERNAL_SITES.map((site) => (
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
