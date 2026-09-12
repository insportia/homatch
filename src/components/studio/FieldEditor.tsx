import React from 'react';
import { Check, Languages, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { LOCALES, fieldStatus, localeState, readLocalized, suggestionFor } from '@/site/model';
import type { SiteItem } from '@/site/model';
import type { StudioState } from './useStudioState';
import { StateBadge, StateDot } from './StateDot';

/**
 * THE FIELD EDITOR.
 *
 * Each field shows, for the language being edited: the value, where that
 * value came from, and whether anyone should look at it. Underneath, the
 * other five languages as a row of dots, so an admin editing Georgian can see
 * at a glance that Arabic went stale two edits ago without leaving the field.
 *
 * The SUGGESTION is drawn as a separate block below the input, never inside
 * it. That is the visual form of the rule the model enforces: a machine
 * translation is a proposal sitting next to the approved text, and it takes a
 * deliberate Apply to become the text. Nothing here can type into another
 * locale's box.
 *
 * ONE COMPONENT FOR A SECTION'S FIELD AND A CARD'S FIELD
 *
 * `item` switches which field host is being edited, and nothing else: same
 * status badge, same five dots, same suggestion block, same review actions.
 * The alternative — a simpler editor for the fields inside a card — is how a
 * product ends up with translation status that is visible for headings and
 * invisible for the content underneath them.
 */
export interface FieldDef {
  key: string;
  labelKey: string;
  kind: string;
  fallback: string | null;
}

export function FieldEditor({
  studio, field, item, placeholderKey,
}: {
  studio: StudioState;
  field: FieldDef;
  /** The repeated child this field belongs to, or undefined for the section. */
  item?: SiteItem;
  /** Shown in an empty box that has no shipped copy to fall back to. */
  placeholderKey?: string;
}) {
  const { t } = useLanguage();
  const {
    selected, locale, editField, editItemText,
    acceptSuggestion, rejectSuggestion, approveLocale,
    mode, runTranslation, translating,
  } = studio;
  if (!selected) return null;

  const host = item ?? selected;
  const write = (value: string) => (item
    ? editItemText(selected.id, item.id, field.key, value)
    : editField(field.key, value));

  const value = readLocalized(host.content[field.key], locale) ?? '';
  const status = fieldStatus(host.content[field.key], locale, field.fallback !== null);
  const state = localeState(host, field.key, locale);
  const suggestion = suggestionFor(host, field.key, locale);
  const Control = field.kind === 'textarea' ? Textarea : Input;
  const id = `f-${item ? `${item.id}-` : ''}${field.key}`;

  return (
    <div className="space-y-2 border-b py-4 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className="text-[15px] font-medium">
          {t(field.labelKey)}
        </Label>
        <StateBadge state={state} />
      </div>

      <Control
        id={id}
        value={value}
        rows={field.kind === 'textarea' ? 4 : undefined}
        onChange={e => write(e.target.value)}
        // An empty box on a designed section means "use the site's own copy",
        // so the placeholder shows what that copy currently is rather than
        // inventing a hint. A block an admin created has no such copy, and
        // gets a prompt instead.
        placeholder={field.fallback ? t(field.fallback) : placeholderKey ? t(placeholderKey) : ''}
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
              title={`${other}: ${t(`studio_state_${localeState(host, field.key, other)}`)}`}
            >
              <StateDot state={localeState(host, field.key, other)} />
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
            onClick={() => approveLocale(field.key, locale, item?.id)}
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
              onClick={() => acceptSuggestion(field.key, locale, item?.id)}
            >
              <Check className="h-3.5 w-3.5" />
              {t('studio_apply')}
            </Button>
            <Button
              variant="ghost" size="sm" className="h-7 gap-1.5 px-2.5 text-[14px]"
              onClick={() => rejectSuggestion(field.key, locale, item?.id)}
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
