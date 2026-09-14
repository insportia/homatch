import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RotateCcw, Search, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  LOCALES, type ContentLocale, type OverrideMap,
  groups, holesIn, localeCoverage, search, shipped, validateOverride,
} from '@/i18n/appContent';
import { loadOverrides, setOverride } from '@/services/appContent';
import { cn } from '@/lib/utils';

/**
 * APP CONTENT — every string the product says, editable.
 *
 * Site Studio edits nine marketing pages and the shell. This is the other
 * 4,773 strings: the dashboard, Credits, outreach, every empty state, every
 * confirmation, every error a person is meant to act on. Until now the only
 * way to change one was a deploy, which meant the people who know what the
 * product should say were not the people who could change what it says.
 *
 * WHY IT IS A SEARCH AND NOT A TREE
 *
 * Four and a half thousand strings do not have a structure anybody can
 * navigate. They have a thing you are looking for. So the surface is a search
 * over both the key and the text — because nobody remembers that the sentence
 * they want is called `empty_no_notifications_desc`, they remember the
 * sentence — with the key prefixes offered as a coarse filter for the times
 * you want to read a whole area at once.
 *
 * WHY A RESULT LIST IS CAPPED
 *
 * Rendering four thousand textareas is a page that does not scroll. The cap
 * is stated rather than silent: a count of matches sits above the list, so an
 * empty-handed search is distinguishable from a search whose answer is below
 * the cut.
 *
 * WHAT IT WILL NOT LET YOU SAVE
 *
 * A replacement that loses a {{placeholder}} or a {n}. Those are filled by
 * code, and dropping one does not fail — it silently renders a sentence with
 * the customer's name, or the count, simply missing. Inventing one is worse:
 * it renders literal braces in front of somebody. Clearing the field
 * entirely is always allowed, and means "put back what shipped".
 */

/** How many results a person can usefully read at once. */
const PAGE = 60;

export default function AppContentPage() {
  const { t } = useLanguage();
  const [locale, setLocale] = useState<ContentLocale>('en');
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);

  const [overrides, setOverrides] = useState<OverrideMap>({});
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState<'FORBIDDEN' | 'UNAVAILABLE' | null>(null);

  const refresh = useCallback(async () => {
    const result = await loadOverrides();
    if (!result.ok) {
      setBlocked(result.reason === 'FORBIDDEN' ? 'FORBIDDEN' : 'UNAVAILABLE');
      setLoading(false);
      return;
    }
    const map: OverrideMap = {};
    for (const row of result.value) (map[row.locale] ??= {})[row.key] = row.value;
    setOverrides(map);
    setBlocked(null);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const allGroups = useMemo(() => groups(), []);
  const matches = useMemo(() => search(query, group, locale), [query, group, locale]);
  const coverage = useMemo(() => localeCoverage(locale, overrides), [locale, overrides]);

  /* A new search shows its own first page rather than the depth of the last. */
  useEffect(() => { setLimit(PAGE); }, [query, group, locale]);

  const save = useCallback(async (key: string, value: string) => {
    const result = await setOverride(key, locale, value);
    if (!result.ok) {
      toast.error(result.reason === 'FORBIDDEN' ? t('app_content_forbidden') : t('app_content_save_failed'));
      return false;
    }
    setOverrides((prev) => {
      const next: OverrideMap = { ...prev, [locale]: { ...(prev[locale] ?? {}) } };
      const bucket = next[locale] as Record<string, string>;
      if (result.value.cleared) delete bucket[key];
      else bucket[key] = value;
      return next;
    });
    toast.success(t('app_content_saved'));
    return true;
  }, [locale, t]);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center gap-2 text-[16px] text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('app_content_loading')}
      </div>
    );
  }

  if (blocked) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-border bg-card p-8 text-center">
        <TriangleAlert className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
        <p className="text-sm text-foreground">
          {blocked === 'FORBIDDEN' ? t('app_content_forbidden') : t('app_content_unavailable')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-foreground">{t('app_content_title')}</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {t('app_content_sub')}
        </p>
      </div>

      {/* ── The language being edited ─────────────────────────────────
          Six buttons rather than a dropdown: the whole point of this screen
          is that a locale is a thing you switch between constantly, and its
          state — how much is translated, how much you have replaced — is
          worth carrying on the control itself. */}
      <div className="flex flex-wrap items-center gap-2">
        {LOCALES.map((code) => {
          const on = code === locale;
          return (
            <button
              key={code}
              type="button"
              onClick={() => setLocale(code)}
              aria-pressed={on}
              className={cn(
                'rounded-full border px-3.5 py-1.5 text-sm font-medium uppercase tracking-wide transition-colors',
                on ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-ink-soft hover:border-foreground/40',
              )}
            >
              {code}
            </button>
          );
        })}
        <span className="ms-1 text-xs text-muted-foreground">
          {t('app_content_coverage', {
            translated: coverage.translated,
            total: coverage.total,
            overridden: coverage.overridden,
          })}
        </span>
      </div>

      {/* ── Finding one string ───────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('app_content_search_ph')}
            className="ps-9"
            aria-label={t('app_content_search_ph')}
          />
        </div>
        <select
          value={group ?? ''}
          onChange={e => setGroup(e.target.value || null)}
          aria-label={t('app_content_group')}
          className="h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground"
        >
          <option value="">{t('app_content_group_all')}</option>
          {allGroups.map(g => (
            <option key={g.name} value={g.name}>{`${g.name} (${g.count})`}</option>
          ))}
        </select>
      </div>

      <p className="text-xs text-muted-foreground">
        {t('app_content_matches', { n: matches.length })}
      </p>

      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {matches.slice(0, limit).map(key => (
          <ContentRow
            key={`${locale}:${key}`}
            contentKey={key}
            locale={locale}
            override={overrides[locale]?.[key]}
            onSave={save}
          />
        ))}
        {matches.length === 0 && (
          <p className="p-8 text-center text-sm text-muted-foreground">{t('app_content_none')}</p>
        )}
      </div>

      {matches.length > limit && (
        <div className="text-center">
          <Button variant="outline" onClick={() => setLimit(n => n + PAGE)}>
            {t('app_content_more', { n: matches.length - limit })}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * One string, in one language.
 *
 * Deliberately shows THREE things: the key, so a developer and an admin can
 * talk about the same string; the copy the application shipped, so it is
 * clear what is being replaced; and — when editing a language that is not
 * English — the English, because a translator who cannot see the source is
 * guessing.
 */
function ContentRow({
  contentKey, locale, override, onSave,
}: {
  contentKey: string;
  locale: ContentLocale;
  override?: string;
  onSave: (key: string, value: string) => Promise<boolean>;
}) {
  const { t } = useLanguage();
  const source = shipped(contentKey, locale);
  const english = shipped(contentKey, 'en') ?? '';
  const [draft, setDraft] = useState(override ?? '');
  const [busy, setBusy] = useState(false);

  /* A save elsewhere, or a locale switch, has to win over a stale draft. */
  useEffect(() => { setDraft(override ?? ''); }, [override, locale, contentKey]);

  const dirty = draft.trim() !== (override ?? '').trim();
  const problem = draft.trim() ? validateOverride(draft, english) : null;
  const holes = holesIn(english);

  /* Untranslated means this locale has no string of its own and is showing
     English. That is legible and wrong, and it is the single most useful
     thing this screen can point at. */
  const untranslated = locale !== 'en' && !source;

  const commit = async () => {
    if (busy || problem) return;
    setBusy(true);
    await onSave(contentKey, draft.trim());
    setBusy(false);
  };

  return (
    /* The key, on the row. Every control in here belongs to ONE string, and
       a test — or a person reading the DOM to work out what they are looking
       at — needs to be able to say which. */
    <div className="p-4 sm:p-5" data-content-key={contentKey}>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 break-all font-mono text-xs text-muted-foreground">{contentKey}</code>
        {override
          ? <Badge variant="outline" className="border-gold/50 text-gold-ink">{t('app_content_state_overridden')}</Badge>
          : untranslated
            ? <Badge variant="outline" className="border-destructive/40 text-destructive">{t('app_content_state_untranslated')}</Badge>
            : <Badge variant="outline" className="text-muted-foreground">{t('app_content_state_shipped')}</Badge>}
        {holes.length > 0 && (
          <span className="font-mono text-[11px] text-muted-foreground">{holes.join(' ')}</span>
        )}
      </div>

      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
        {source ?? english}
      </p>
      {locale !== 'en' && source && english && source !== english && (
        <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground/70">
          <span className="me-1.5 font-medium uppercase tracking-wide">en</span>
          {english}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-start gap-2">
        <Textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          rows={Math.min(6, Math.max(2, Math.ceil((draft.length || (source ?? english).length) / 90)))}
          placeholder={t('app_content_override_ph')}
          className="min-w-0 flex-1"
          aria-label={contentKey}
          dir={locale === 'ar' || locale === 'he' ? 'rtl' : 'ltr'}
        />
        <div className="flex shrink-0 flex-col gap-2">
          <Button size="sm" disabled={!dirty || busy || Boolean(problem)} onClick={() => void commit()}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {t('app_content_save')}
          </Button>
          {override && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => { setDraft(''); void onSave(contentKey, ''); }}
              className="gap-1.5"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t('app_content_reset')}
            </Button>
          )}
        </div>
      </div>

      {problem && (
        <p className="mt-2 text-xs text-destructive">
          {problem.kind === 'MISSING_HOLES' ? t('app_content_err_missing', { holes: problem.holes.join(' ') })
            : problem.kind === 'UNKNOWN_HOLES' ? t('app_content_err_unknown', { holes: problem.holes.join(' ') })
              : problem.kind === 'TOO_LONG' ? t('app_content_err_long', { n: problem.limit })
                : ''}
        </p>
      )}
    </div>
  );
}
