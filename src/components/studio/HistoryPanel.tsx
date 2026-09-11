import React from 'react';
import { History, RotateCcw, Undo2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { readLocalized, setLocalized } from '@/site/model';
import type { StudioState } from './useStudioState';

/**
 * Version history and page-level search settings.
 *
 * TWO WAYS BACK, AND THEY ARE DIFFERENT
 *
 * "Load into draft" puts an old version in the editor so it can be read in
 * every language before anyone commits to it. Nothing public changes. That is
 * the one to reach for almost always.
 *
 * "Publish this version now" is for the case where something wrong is live
 * right now and reading it first is a luxury. It still appends a new version
 * rather than deleting the bad one, so the record of what happened survives
 * the fix.
 */
export function HistoryPanel({ studio }: { studio: StudioState }) {
  const { t } = useLanguage();
  const { versions, restore, rollback, record, draft, setSeo, saving, locale } = studio;

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {/* ── Search and sharing ─────────────────────────────── */}
        <h3 className="text-sm font-semibold">{t('studio_seo')}</h3>
        {/* Search copy is per language like everything else, so these two
            boxes follow the toolbar's editing language rather than being a
            single global value that the last editor silently wins. */}
        <p className="mt-1 text-[11px] uppercase text-muted-foreground">{locale}</p>
        <div className="mt-3 space-y-3">
          <div className="space-y-1">
            <Label htmlFor="seo-title" className="text-[11px]">{t('studio_seo_title')}</Label>
            <Input
              id="seo-title"
              value={readLocalized(draft.seo.title, locale) ?? ''}
              onChange={e => setSeo({ title: setLocalized(draft.seo.title, locale, e.target.value) })}
              className="h-8 text-[12px]"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="seo-desc" className="text-[11px]">{t('studio_seo_desc')}</Label>
            <Textarea
              id="seo-desc"
              rows={3}
              value={readLocalized(draft.seo.description, locale) ?? ''}
              onChange={e => setSeo({ description: setLocalized(draft.seo.description, locale, e.target.value) })}
              className="text-[12px]"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="og-image" className="text-[11px]">{t('studio_og_image')}</Label>
            <Input
              id="og-image"
              value={draft.seo.ogImage ?? ''}
              onChange={e => setSeo({ ogImage: e.target.value })}
              className="h-8 text-[12px]"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="canonical" className="text-[11px]">{t('studio_canonical')}</Label>
            <Input
              id="canonical"
              value={draft.seo.canonical ?? ''}
              onChange={e => setSeo({ canonical: e.target.value })}
              className="h-8 text-[12px]"
            />
          </div>

          {/* Destructive in a way that is invisible for weeks, so it says so
              in words rather than relying on the admin knowing what noindex
              means. */}
          <div className="rounded-md border border-destructive/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="noindex" className="text-[11px] font-medium">
                {t('studio_noindex')}
              </Label>
              <Switch
                id="noindex"
                checked={draft.seo.noindex === true}
                onCheckedChange={v => setSeo({ noindex: v })}
              />
            </div>
            {draft.seo.noindex === true && (
              <p className="mt-2 text-[11px] leading-relaxed text-destructive">
                {t('studio_noindex_warn')}
              </p>
            )}
          </div>
        </div>

        {/* ── Version history ────────────────────────────────── */}
        <h3 className="mt-7 flex items-center gap-2 text-sm font-semibold">
          <History className="h-4 w-4" />
          {t('studio_history')}
        </h3>

        {versions.length === 0 ? (
          <p className="mt-3 text-[12px] text-muted-foreground">{t('studio_no_history')}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {versions.map(v => {
              const live = record?.publishedVersion === v.version;
              return (
                <li key={v.version} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-medium">
                      {t('studio_version')} {v.version}
                    </span>
                    {live && (
                      <span className="rounded bg-emerald-600/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                        {t('studio_live')}
                      </span>
                    )}
                  </div>
                  {v.note && (
                    <p className="mt-1 text-[11px] text-muted-foreground">{v.note}</p>
                  )}
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {v.publishedAt ? new Date(v.publishedAt).toLocaleString() : ''}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button
                      variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-[11px]"
                      disabled={saving}
                      onClick={() => void restore(v.version)}
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                      {t('studio_restore')}
                    </Button>
                    {!live && (
                      <Button
                        variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-[11px]"
                        disabled={saving}
                        onClick={() => void rollback(v.version)}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {t('studio_rollback')}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
