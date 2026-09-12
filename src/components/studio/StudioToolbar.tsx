import React from 'react';
import {
  Languages, Loader2, Monitor, MousePointerClick, Redo2, RotateCcw, Save, Send,
  Smartphone, Tablet, Undo2,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { LOCALES, type Locale, type TranslationMode } from '@/site/model';
import { EDITABLE_PAGES, type PageSlug } from '@/services/siteContent';
import type { TranslationKey } from '@/i18n/translations';
import { DEVICE_WIDTHS, type DeviceKey } from './StudioPreview';
import type { StudioState } from './useStudioState';

const LOCALE_LABELS: Record<Locale, string> = {
  en: 'EN', ka: 'ქარ', ru: 'RU', tr: 'TR', ar: 'AR', he: 'HE',
};

/**
 * The bar that decides what you are looking at and what happens to it.
 *
 * Save and Publish are visually distinct because they are different in kind:
 * one is private and reversible, the other is the public website changing.
 * The draft-only notice next to them is permanent rather than a transient
 * toast, so there is never a moment where an admin believes the site has
 * changed when it has not.
 */
export function StudioToolbar({
  studio, device, setDevice, forceRTL, setForceRTL, inlineEdit, setInlineEdit,
}: {
  studio: StudioState;
  device: DeviceKey;
  setDevice: (d: DeviceKey) => void;
  forceRTL: boolean;
  setForceRTL: (v: boolean) => void;
  inlineEdit: boolean;
  setInlineEdit: (v: boolean) => void;
}) {
  const { t } = useLanguage();
  const {
    slug, setSlug, locale, setLocale, mode, setMode, dirty, saving,
    undo, redo, canUndo, canRedo, discard,
    save, publish, unavailable, translating, translateProgress, runTranslation,
  } = studio;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
      <Select value={slug} onValueChange={v => setSlug(v as PageSlug)}>
        <SelectTrigger className="h-8 w-[130px] text-[15px]">
          <SelectValue placeholder={t('studio_page')} />
        </SelectTrigger>
        <SelectContent>
          {/* Every editable page, from one list, so adding a page to the
              site adds it to the editor rather than to a to-do. */}
          {EDITABLE_PAGES.map(page => (
            <SelectItem key={page.slug} value={page.slug} className="text-[15px]">
              {t(page.labelKey as TranslationKey)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Editing language. Separate from the admin's own UI language on
          purpose: checking the Arabic page should not turn the editor Arabic. */}
      <div className="flex items-center rounded-md border p-0.5">
        {LOCALES.map(l => (
          <button
            key={l}
            type="button"
            onClick={() => setLocale(l)}
            className={`rounded px-2 py-1 text-[14px] font-medium transition-colors ${
              locale === l ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
            }`}
          >
            {LOCALE_LABELS[l]}
          </button>
        ))}
      </div>

      <div className="flex items-center rounded-md border p-0.5">
        {DEVICE_WIDTHS.map(d => {
          const Icon = d.key === 'desktop' ? Monitor : d.key === 'tablet' ? Tablet : Smartphone;
          const label = d.labelKey ? t(d.labelKey) : `${d.width}`;
          return (
            <button
              key={d.key}
              type="button"
              onClick={() => setDevice(d.key)}
              title={label}
              aria-label={label}
              className={`flex items-center gap-1 rounded px-2 py-1 text-[14px] transition-colors ${
                device === d.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {d.width && d.key !== 'tablet' ? d.width : null}
            </button>
          );
        })}
      </div>

      {/* Click-to-edit is a mode, not the default: an admin reviewing the
          page should be able to click a link and follow it. */}
      {/*
        * UNDO AND REDO.
        *
        * First in the utility run, because they are the answer to
        * "I did not mean that" and somebody looking for that answer
        * should not have to read the rest of the bar first.
        */}
      <div className="flex items-center rounded-md border">
        <Button
          variant="ghost" size="sm" className="h-8 w-8 rounded-e-none p-0"
          onClick={undo}
          disabled={!canUndo}
          title={t('studio_undo')}
          aria-label={t('studio_undo')}
        >
          <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost" size="sm" className="h-8 w-8 rounded-s-none border-s p-0"
          onClick={redo}
          disabled={!canRedo}
          title={t('studio_redo')}
          aria-label={t('studio_redo')}
        >
          <Redo2 className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>

      {/* Only offered when there is something to throw away. */}
      {dirty && (
        <Button
          variant="ghost" size="sm" className="h-8 gap-1.5 text-[14px] text-muted-foreground"
          onClick={discard}
          title={t('studio_discard_hint')}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          {t('studio_discard')}
        </Button>
      )}

      <Button
        variant={inlineEdit ? 'default' : 'outline'}
        size="sm"
        className="h-8 gap-1.5 text-[14px]"
        onClick={() => setInlineEdit(!inlineEdit)}
        title={t('studio_inline_hint')}
        aria-pressed={inlineEdit}
        disabled={unavailable}
      >
        <MousePointerClick className="h-3.5 w-3.5" aria-hidden="true" />
        {t('studio_inline_edit')}
      </Button>

      <Button
        variant={forceRTL ? 'default' : 'outline'}
        size="sm"
        className="h-8 text-[14px]"
        onClick={() => setForceRTL(!forceRTL)}
      >
        {t('studio_rtl')}
      </Button>

      <Select value={mode} onValueChange={v => setMode(v as TranslationMode)}>
        <SelectTrigger className="h-8 w-[190px] text-[15px]">
          <SelectValue placeholder={t('studio_mode')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="manual" className="text-[15px]">{t('studio_mode_manual')}</SelectItem>
          <SelectItem value="suggest" className="text-[15px]">{t('studio_mode_suggest')}</SelectItem>
          <SelectItem value="auto_all" className="text-[15px]">{t('studio_mode_auto')}</SelectItem>
        </SelectContent>
      </Select>

      {mode !== 'manual' && (
        <Button
          variant="outline" size="sm" className="h-8 gap-1.5 text-[14px]"
          disabled={translating || unavailable}
          onClick={() => void runTranslation('page')}
        >
          {translating
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <Languages className="h-3.5 w-3.5" />}
          {translating && translateProgress
            ? `${t('studio_translating')} ${translateProgress.done}/${translateProgress.total}`
            : mode === 'auto_all' ? t('studio_translate_missing') : t('studio_translate_changed')}
        </Button>
      )}

      <div className="ms-auto flex items-center gap-2">
        {dirty && (
          <span className="text-[14px] text-amber-600">{t('studio_unsaved')}</span>
        )}
        <Button
          variant="outline" size="sm" className="h-8 gap-1.5 text-[14px]"
          disabled={saving || unavailable || !dirty}
          onClick={() => void save()}
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {t('studio_save_draft')}
        </Button>
        <Button
          size="sm" className="h-8 gap-1.5 text-[14px]"
          disabled={saving || unavailable}
          onClick={() => void publish()}
        >
          <Send className="h-3.5 w-3.5" />
          {t('studio_publish')}
        </Button>
      </div>
    </div>
  );
}
