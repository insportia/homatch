import React, { useRef, useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { STYLE_AXES, readLocalized, type StyleAxis } from '@/site/model';
import { sectionDef } from '@/site/registry';
import { uploadAsset } from '@/services/siteContent';
import type { StudioState } from './useStudioState';
import { FieldEditor } from './FieldEditor';
import { IconPicker } from './IconPicker';
import { ItemsPanel } from './ItemsPanel';
import { VideoEditor } from './VideoEditor';

/**
 * WHAT THE SELECTED BLOCK IS MADE OF.
 *
 * Everything here comes from the registry: the fields, the icon slots, the
 * pictures, the variants and the shape of the repeated children. A control
 * that is not declared does not appear, and a value it could not produce is
 * rejected on load anyway — so there is no combination of clicks in this
 * panel that produces a page the design system cannot render.
 *
 * The panel is not where most writing happens. Text is typed on the page
 * itself, where an admin can see it. What the panel is for is everything that
 * has no natural place on the canvas: a layout choice, a translation to
 * approve, an icon, a video address, and the order of the cards.
 */

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
  const { selected, setVariant, setTheme, setSpacing, setStyle, setEnabled, setIcon } = studio;

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

        {/* ── Style presets ───────────────────────────────────────────
            Built from STYLE_AXES rather than written out, so an axis added
            to the vocabulary appears here with nothing to remember, and an
            axis removed from it cannot leave a control behind that writes a
            value normalizePage will throw away.

            A section with no style object at all — everything saved before
            presets existed — reads as 'default' on every axis, which is the
            section exactly as it was designed. */}
        <div className="space-y-3 border-b py-4">
          <Label className="text-[15px] font-medium">{t('studio_style')}</Label>
          {(Object.keys(STYLE_AXES) as StyleAxis[]).map(axis => (
            <div key={axis} className="space-y-1">
              <Label className="text-[14px] text-muted-foreground">
                {t(`studio_style_${axis.toLowerCase()}` as Parameters<typeof t>[0])}
              </Label>
              <Select
                value={selected.style?.[axis] ?? 'default'}
                onValueChange={v => setStyle(axis, v as never)}
              >
                <SelectTrigger className="h-8 text-[15px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STYLE_AXES[axis].map(step => (
                    <SelectItem key={step} value={step} className="text-[15px]">
                      {t(`studio_step_${step.toLowerCase()}` as Parameters<typeof t>[0])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>

        {def.fields.map(field => (
          <FieldEditor key={field.key} studio={studio} field={field} />
        ))}

        {(def.icons ?? []).map(icon => (
          <IconPicker
            key={icon.slot}
            labelKey={icon.labelKey}
            value={selected.icons[icon.slot]}
            onChange={name => setIcon(icon.slot, name)}
          />
        ))}

        {def.media.map(m => (m.kind === 'video'
          ? <VideoEditor key={m.slot} studio={studio} slot={m.slot} labelKey={m.labelKey} />
          : <MediaEditor key={m.slot} studio={studio} slot={m.slot} labelKey={m.labelKey} />
        ))}

        {def.items && <ItemsPanel studio={studio} def={def.items} />}

        <div className="h-6" />
      </div>
    </div>
  );
}
