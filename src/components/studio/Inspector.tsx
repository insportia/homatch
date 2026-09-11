import React, { useRef, useState } from 'react';
import { Check, Languages, Loader2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { LOCALES, fieldStatus, localeState, readLocalized, suggestionFor } from '@/site/model';
import { sectionDef } from '@/site/registry';
import { uploadAsset } from '@/services/siteContent';
import type { StudioState } from './useStudioState';
import { StateBadge, StateDot } from './StateDot';

/**
 * THE FIELD EDITOR.
 *
 * Each field shows, for the language being edited: the value, where that
 * value came from, and whether anyone should look at it. Underneath, the
 * other five languages as a row of dots, so an admin editing Georgian can
 * see at a glance that Arabic went stale two edits ago without leaving the
 * field.
 *
 * The SUGGESTION is drawn as a separate block below the input, never inside
 * it. That is the visual form of the rule the model enforces: a machine
 * translation is a proposal sitting next to the approved text, and it takes a
 * deliberate Apply to become the text. Nothing here can type into another
 * locale's box.
 */

function FieldEditor({ studio, field }: { studio: StudioState; field: { key: string; labelKey: string; kind: string; fallback: string | null } }) {
  const { t } = useLanguage();
  const { selected, locale, editField, acceptSuggestion, rejectSuggestion, approveLocale, mode, runTranslation, translating } = studio;
  if (!selected) return null;

  const value = readLocalized(selected.content[field.key], locale) ?? '';
  const status = fieldStatus(selected.content[field.key], locale, field.fallback !== null);
  const state = localeState(selected, field.key, locale);
  const suggestion = suggestionFor(selected, field.key, locale);
  const Control = field.kind === 'textarea' ? Textarea : Input;

  return (
    <div className="space-y-2 border-b py-4 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`f-${field.key}`} className="text-[15px] font-medium">
          {t(field.labelKey)}
        </Label>
        <StateBadge state={state} />
      </div>

      <Control
        id={`f-${field.key}`}
        value={value}
        rows={field.kind === 'textarea' ? 4 : undefined}
        onChange={e => editField(field.key, e.target.value)}
        // An empty box means "use the site's own copy", so the placeholder
        // shows what that copy currently is rather than inventing a hint.
        placeholder={field.fallback ? t(field.fallback) : ''}
        className="text-[16px]"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[14px] text-muted-foreground">
          {status === 'default' ? t('studio_badge_default')
            : status === 'missing' ? t('studio_badge_missing')
            : t('studio_badge_edited')}
        </span>

        <div className="flex items-center gap-2">
          {/* The other five languages, as dots. Clicking one switches to it. */}
          {LOCALES.filter(l => l !== locale).map(other => (
            <button
              key={other}
              type="button"
              onClick={() => studio.setLocale(other)}
              className="flex items-center gap-1 rounded px-1 py-0.5 text-[13px] uppercase text-muted-foreground hover:bg-accent"
              title={`${other}: ${t(`studio_state_${localeState(selected, field.key, other)}`)}`}
            >
              <StateDot state={localeState(selected, field.key, other)} />
              {other}
            </button>
          ))}

          {mode !== 'manual' && (
            <Button
              variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-[14px]"
              disabled={translating || !value}
              onClick={() => void runTranslation('field', field.key)}
            >
              <Languages className="h-3.5 w-3.5" />
              {t('studio_translate_field')}
            </Button>
          )}
        </div>
      </div>

      {state === 'needs_update' && !suggestion && (
        <div className="flex items-center justify-between gap-2 rounded-md bg-amber-500/10 px-3 py-2">
          <span className="text-[14px] text-muted-foreground">{t('studio_state_needs_update')}</span>
          <Button
            variant="ghost" size="sm" className="h-6 px-2 text-[14px]"
            onClick={() => approveLocale(field.key, locale)}
          >
            {t('studio_mark_reviewed')}
          </Button>
        </div>
      )}

      {suggestion && (
        <div className="space-y-2 rounded-md border border-sky-500/40 bg-sky-500/[0.06] p-3">
          <p className="text-[14px] font-medium text-muted-foreground">{t('studio_suggestion')}</p>
          <p className="whitespace-pre-wrap text-[16px] leading-relaxed">{suggestion}</p>
          <div className="flex gap-2">
            <Button
              size="sm" className="h-7 gap-1.5 px-2.5 text-[14px]"
              onClick={() => acceptSuggestion(field.key, locale)}
            >
              <Check className="h-3.5 w-3.5" />
              {t('studio_apply')}
            </Button>
            <Button
              variant="ghost" size="sm" className="h-7 gap-1.5 px-2.5 text-[14px]"
              onClick={() => rejectSuggestion(field.key, locale)}
            >
              <X className="h-3.5 w-3.5" />
              {t('studio_dismiss')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function MediaEditor({ studio, slot, labelKey }: { studio: StudioState; slot: string; labelKey: string }) {
  const { t } = useLanguage();
  const { selected, locale, setMedia } = studio;
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  if (!selected) return null;

  const current = selected.media[slot];
  const alt = readLocalized(current?.alt, locale) ?? '';

  async function onFile(file: File) {
    setBusy(true);
    const result = await uploadAsset(file);
    setBusy(false);
    if (!result.ok) {
      toast.error(t('studio_asset_reject', { reason: result.message ?? '' }));
      return;
    }
    setMedia(slot, result.value, alt);
  }

  return (
    <div className="space-y-2 border-b py-4">
      <Label className="text-[15px] font-medium">{t(labelKey)}</Label>

      {current && (
        <img
          src={current.url}
          alt=""
          className="h-24 w-full rounded-md border object-cover"
        />
      )}

      <div className="flex gap-2">
        <Button
          variant="outline" size="sm" className="h-8 gap-1.5 text-[14px]"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {busy ? t('studio_asset_uploading') : t('studio_asset_upload')}
        </Button>
        {current && (
          <Button
            variant="ghost" size="sm" className="h-8 text-[14px]"
            onClick={() => setMedia(slot, null)}
          >
            {t('studio_asset_remove')}
          </Button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif,image/svg+xml"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) void onFile(file);
          e.target.value = '';
        }}
      />

      {current && (
        <div className="space-y-1">
          <Label htmlFor={`alt-${slot}`} className="text-[14px] text-muted-foreground">
            {t('studio_asset_alt')}
          </Label>
          <Input
            id={`alt-${slot}`}
            value={alt}
            onChange={e => setMedia(slot, current.url, e.target.value)}
            className="h-8 text-[15px]"
          />
        </div>
      )}
    </div>
  );
}

export function Inspector({ studio }: { studio: StudioState }) {
  const { t } = useLanguage();
  const { selected, setVariant, setTheme, setSpacing, setEnabled } = studio;

  if (!selected) {
    return (
      <div className="grid h-full place-items-center p-6 text-center text-[16px] text-muted-foreground">
        {t('studio_select_section')}
      </div>
    );
  }

  const def = sectionDef(selected.type);
  if (!def) return null;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{t(def.labelKey)}</h2>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        <div className="flex items-center justify-between border-b py-4">
          <Label htmlFor="sec-enabled" className="text-[15px] font-medium">
            {t('studio_enabled')}
          </Label>
          <Switch
            id="sec-enabled"
            checked={selected.enabled}
            onCheckedChange={setEnabled}
          />
        </div>

        {/* §11: layout is a choice from a list the component implements, not
            a set of CSS boxes. A variant that is not in the registry cannot
            be selected here and would be rejected on load anyway. */}
        {def.variants.length > 1 && (
          <div className="space-y-1.5 border-b py-4">
            <Label className="text-[15px] font-medium">{t('studio_variant')}</Label>
            <Select value={selected.variant} onValueChange={setVariant}>
              <SelectTrigger className="h-8 text-[15px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {def.variants.map(v => (
                  <SelectItem key={v} value={v} className="text-[15px]">{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {def.themes.length > 0 && (
          <div className="space-y-1.5 border-b py-4">
            <Label className="text-[15px] font-medium">{t('studio_theme')}</Label>
            <Select
              value={selected.theme ?? 'light'}
              onValueChange={v => setTheme(v as 'light' | 'dark')}
            >
              <SelectTrigger className="h-8 text-[15px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {def.themes.map(v => (
                  <SelectItem key={v} value={v} className="text-[15px]">{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-1.5 border-b py-4">
          <Label className="text-[15px] font-medium">{t('studio_spacing')}</Label>
          <Select
            value={selected.spacing}
            onValueChange={v => setSpacing(v as 'compact' | 'normal' | 'spacious')}
          >
            <SelectTrigger className="h-8 text-[15px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="compact" className="text-[15px]">{t('studio_spacing_compact')}</SelectItem>
              <SelectItem value="normal" className="text-[15px]">{t('studio_spacing_normal')}</SelectItem>
              <SelectItem value="spacious" className="text-[15px]">{t('studio_spacing_spacious')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {def.fields.map(field => (
          <FieldEditor key={field.key} studio={studio} field={field} />
        ))}

        {def.media.map(m => (
          <MediaEditor key={m.slot} studio={studio} slot={m.slot} labelKey={m.labelKey} />
        ))}

        <div className="h-6" />
      </div>
    </div>
  );
}
