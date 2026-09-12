import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  loadPage, saveDraft, publishPage, restoreVersion, rollbackTo,
  type PageSlug, type SitePageRecord, type StudioResult,
} from '@/services/siteContent';
import {
  DEFAULT_TRANSLATION_MODE, type Locale, type SitePageContent, type SiteSection,
  type SiteVersion, type TranslationMode,
  applyAutoTranslation, applySuggestion, dismissSuggestion, duplicateSection as duplicate,
  editLocale, insertSectionAfter,
  emptyPage, makeSection, markReviewed, moveSection, setSectionEnabled,
  setSuggestion, translationTargets,
} from '@/site/model';
import { SECTION_DEFS, sectionDef } from '@/site/registry';
import { DEFAULT_HOME_ORDER, DEFAULT_ABOUT_ORDER } from '@/site/render/SitePage';
import { translateBatch, type BatchItem } from '@/site/translate';

/**
 * ALL THE EDITOR'S STATE, IN ONE PLACE.
 *
 * The page being edited is a plain object from src/site/model.ts, and every
 * change goes through one of that module's pure functions. Nothing in the UI
 * mutates a section directly, which is what makes the translation guarantees
 * hold in the product and not only in the tests: the component tree has no
 * way to write a locale's text except through editLocale.
 *
 * Nothing here autosaves. A draft is written when the admin says so. An
 * editor that saves as you type turns "I was trying something" into a stored
 * change, and with publish one click away that is the wrong default.
 */

/** A page starts as the running order the code ships, made editable. */
function seedPage(slug: PageSlug): SitePageContent {
  const order = slug === 'about' ? DEFAULT_ABOUT_ORDER : DEFAULT_HOME_ORDER;
  return {
    ...emptyPage(),
    sections: order.map(type => makeSection(type, `${type}-1`)),
  };
}

export interface StudioState {
  slug: PageSlug;
  setSlug: (slug: PageSlug) => void;

  loading: boolean;
  /** Set when the backend has no site_pages table yet. Editing is off. */
  unavailable: boolean;

  record: SitePageRecord | null;
  versions: SiteVersion[];

  draft: SitePageContent;
  dirty: boolean;

  selectedId: string | null;
  select: (id: string | null) => void;
  selected: SiteSection | null;

  /** The language being edited, independent of the admin's own UI language. */
  locale: Locale;
  setLocale: (locale: Locale) => void;

  mode: TranslationMode;
  setMode: (mode: TranslationMode) => void;

  editField: (field: string, value: string) => void;
  /** Edit a field on a NAMED section — used by inline, on-page editing. */
  editSectionField: (
    sectionId: string, field: string, value: string, atLocale?: Locale,
  ) => void;
  setVariant: (variant: string) => void;
  setTheme: (theme: 'light' | 'dark' | null) => void;
  setSpacing: (spacing: SiteSection['spacing']) => void;
  setEnabled: (enabled: boolean, id?: string) => void;
  setMedia: (slot: string, url: string | null, alt?: string, atSection?: string) => void;
  move: (id: string, delta: number) => void;
  addSection: (type: string, afterId?: string) => void;
  /** Copy a repeatable section, with its content, directly below itself. */
  duplicateSection: (id: string) => void;
  removeSection: (id: string) => void;
  setSeo: (patch: Partial<SitePageContent['seo']>) => void;

  acceptSuggestion: (field: string, locale: Locale) => void;
  rejectSuggestion: (field: string, locale: Locale) => void;
  approveLocale: (field: string, locale: Locale) => void;

  translating: boolean;
  translateProgress: { done: number; total: number } | null;
  runTranslation: (scope: 'field' | 'section' | 'page', field?: string) => Promise<void>;

  saving: boolean;
  save: () => Promise<void>;
  publish: (note?: string) => Promise<void>;
  restore: (version: number) => Promise<void>;
  rollback: (version: number) => Promise<void>;
}

export function useStudioState(): StudioState {
  const { t } = useLanguage();

  const [slug, setSlugState] = useState<PageSlug>('home');
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [record, setRecord] = useState<SitePageRecord | null>(null);
  const [versions, setVersions] = useState<SiteVersion[]>([]);
  const [draft, setDraft] = useState<SitePageContent>(() => seedPage('home'));
  const [dirty, setDirty] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [locale, setLocale] = useState<Locale>('en');
  const [mode, setMode] = useState<TranslationMode>(DEFAULT_TRANSLATION_MODE);
  const [saving, setSaving] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translateProgress, setTranslateProgress] = useState<{ done: number; total: number } | null>(null);

  /* ── Loading ──────────────────────────────────────────────── */

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setUnavailable(false);

    void loadPage(slug).then(result => {
      if (!alive) return;
      setLoading(false);

      if (!result.ok) {
        if (result.reason === 'UNAVAILABLE') setUnavailable(true);
        else toast.error(t('studio_error'));
        // A failed load still gives the admin the code's own running order to
        // look at, read-only. Showing an empty editor would imply the site
        // has no sections, which is the opposite of the truth.
        setDraft(seedPage(slug));
        setRecord(null);
        setVersions([]);
        return;
      }

      const { page, versions: list } = result.value;
      setRecord(page);
      setVersions(list);
      // A page nobody has edited yet has an empty draft. Seed it from the
      // code so every section is present and selectable from the first visit.
      setDraft(page.draft.sections.length > 0 ? page.draft : seedPage(slug));
      setDirty(false);
      setSelectedId(null);
    });

    return () => { alive = false; };
  }, [slug, t]);

  const setSlug = useCallback((next: PageSlug) => {
    setSlugState(next);
    setSelectedId(null);
  }, []);

  /* ── Editing ──────────────────────────────────────────────── */

  const selected = useMemo(
    () => draft.sections.find(s => s.id === selectedId) ?? null,
    [draft.sections, selectedId],
  );

  /** Replace one section, leaving the rest of the page identical. */
  const patch = useCallback((id: string, fn: (s: SiteSection) => SiteSection) => {
    setDraft(prev => ({
      ...prev,
      sections: prev.sections.map(s => (s.id === id ? fn(s) : s)),
    }));
    setDirty(true);
  }, []);

  const editField = useCallback((field: string, value: string) => {
    if (!selectedId) return;
    patch(selectedId, s => editLocale(s, field, locale, value));
  }, [selectedId, locale, patch]);

  /**
   * The same edit, but for a named section.
   *
   * Inline editing on the page commits from a blur handler, and by then
   * the click that moved the caret may already have changed the selection.
   * Routing that through `selectedId` is the same mistake setEnabled had:
   * it would write the text into whichever section happened to be selected
   * at commit time. The element knows which section it belongs to, so it
   * says so.
   */
  const editSectionField = useCallback((
    sectionId: string, field: string, value: string, atLocale?: Locale,
  ) => {
    /*
     * The locale is the ELEMENT's, not the editor's.
     *
     * Both are almost always the same, and 'almost always' is the problem:
     * a commit fires on blur, and switching language is a click somewhere
     * else, which blurs. Reading the editor's current locale at that
     * moment would write English text into the Georgian field of the
     * language the admin had just switched to. The element was rendered in
     * a known locale and carries it, so the edit goes where the words came
     * from.
     */
    patch(sectionId, s => editLocale(s, field, atLocale ?? locale, value));
  }, [locale, patch]);

  const setVariant = useCallback((variant: string) => {
    if (!selectedId) return;
    patch(selectedId, s => ({ ...s, variant }));
  }, [selectedId, patch]);

  const setTheme = useCallback((theme: 'light' | 'dark' | null) => {
    if (!selectedId) return;
    patch(selectedId, s => ({ ...s, theme }));
  }, [selectedId, patch]);

  const setSpacing = useCallback((spacing: SiteSection['spacing']) => {
    if (!selectedId) return;
    patch(selectedId, s => ({ ...s, spacing }));
  }, [selectedId, patch]);

  /**
   * Show or hide a section.
   *
   * `id` is explicit because the structure list toggles a row's eye without
   * that row necessarily being the selected one. Selecting and toggling in
   * one handler cannot work through the selection: select() only schedules
   * the state change, so the toggle would still read the PREVIOUS selection
   * and either do nothing or hide a different section than the one clicked.
   * The inspector's switch has no id to hand and means "the selected one",
   * which is what the default covers.
   */
  const setEnabled = useCallback((enabled: boolean, id?: string) => {
    const target = id ?? selectedId;
    if (!target) return;
    setDraft(prev => setSectionEnabled(prev, target, enabled));
    setDirty(true);
  }, [selectedId]);

  /**
   * Replace, or clear, one image slot.
   *
   * `atSection` is explicit for the same reason the inline text commit's
   * section is: clicking a picture on the canvas selects its section, and
   * an upload finishes some seconds later, by which time the selection
   * may have moved. The picture that was clicked is the one that changes.
   */
  const setMedia = useCallback((
    slot: string, url: string | null, alt?: string, atSection?: string,
  ) => {
    const target = atSection ?? selectedId;
    if (!target) return;
    patch(target, s => {
      const media = { ...s.media };
      if (url === null) delete media[slot];
      else media[slot] = { url, alt: { ...(media[slot]?.alt ?? {}), [locale]: alt ?? '' } };
      return { ...s, media };
    });
  }, [selectedId, locale, patch]);

  const move = useCallback((id: string, delta: number) => {
    setDraft(prev => moveSection(prev, id, delta));
    setDirty(true);
  }, []);

  /**
   * Add a section, optionally directly below an existing one.
   *
   * `afterId` is what makes "Add below" mean what it says. Without it a
   * new block always lands at the bottom of the page, and the admin has
   * to walk it up one press at a time.
   */
  const addSection = useCallback((type: string, afterId?: string) => {
    const def = sectionDef(type);
    if (!def || !def.repeatable) return;
    const id = `${type}-${crypto.randomUUID().slice(0, 8)}`;
    setDraft(prev => insertSectionAfter(prev, type, id, afterId));
    setDirty(true);
    setSelectedId(id);
  }, []);

  /**
   * Copy a section, with its words, directly below the original.
   *
   * Deep-cloned, because the localized content and media objects are
   * nested: a shallow copy would leave the duplicate sharing the
   * original's strings, and editing one would silently edit both.
   *
   * Restricted to repeatable types for the same reason delete is. There
   * is one hero, and a second copy of it is not a page the design
   * supports.
   */
  const duplicateSection = useCallback((id: string) => {
    setDraft(prev => {
      const source = prev.sections.find(x => x.id === id);
      // Same rule as delete: only the block that can genuinely repeat.
      if (!source || !sectionDef(source.type)?.repeatable) return prev;
      return duplicate(prev, id, `${source.type}-${crypto.randomUUID().slice(0, 8)}`);
    });
    setDirty(true);
  }, []);

  const removeSection = useCallback((id: string) => {
    const section = draft.sections.find(s => s.id === id);
    // Only the repeatable block can actually be deleted. Everything else is a
    // region of the shipped design, and the honest control for it is "hide",
    // which is reversible and which the code still renders by default.
    if (!section || !sectionDef(section.type)?.repeatable) return;
    setDraft(prev => ({ ...prev, sections: prev.sections.filter(s => s.id !== id) }));
    setDirty(true);
    setSelectedId(null);
  }, [draft.sections]);

  const setSeo = useCallback((p: Partial<SitePageContent['seo']>) => {
    setDraft(prev => ({ ...prev, seo: { ...prev.seo, ...p } }));
    setDirty(true);
  }, []);

  /* ── Translation review ───────────────────────────────────── */

  const acceptSuggestion = useCallback((field: string, target: Locale) => {
    if (!selectedId) return;
    patch(selectedId, s => applySuggestion(s, field, target));
  }, [selectedId, patch]);

  const rejectSuggestion = useCallback((field: string, target: Locale) => {
    if (!selectedId) return;
    patch(selectedId, s => dismissSuggestion(s, field, target));
  }, [selectedId, patch]);

  const approveLocale = useCallback((field: string, target: Locale) => {
    if (!selectedId) return;
    patch(selectedId, s => markReviewed(s, field, target));
  }, [selectedId, patch]);

  /* ── Translation generation ───────────────────────────────── */

  const runTranslation = useCallback(async (
    scope: 'field' | 'section' | 'page', field?: string,
  ) => {
    if (translating) return;
    if (mode === 'manual') return;

    const targets = translationTargets(draft, {
      sourceLocale: locale,
      sectionId: scope === 'page' ? undefined : selectedId ?? undefined,
      field: scope === 'field' ? field : undefined,
      // "Translate all locales" is also the mode that fills the gaps; the
      // suggest mode only chases what the admin's own edits made stale.
      includeMissing: mode === 'auto_all',
    });

    if (targets.length === 0) {
      toast.info(t('studio_translate_none'));
      return;
    }

    setTranslating(true);
    setTranslateProgress({ done: 0, total: targets.length });

    const items: BatchItem[] = targets.map(target => {
      const section = draft.sections.find(s => s.id === target.sectionId);
      const def = section ? sectionDef(section.type) : undefined;
      const fieldDef = def?.fields.find(f => f.key === target.field);
      return {
        ...target,
        // Telling the model what the string IS keeps a button label from
        // coming back as a sentence.
        role: fieldDef ? t(fieldDef.labelKey).toLowerCase() : undefined,
      };
    });

    const results = await translateBatch(items, (done, total) => {
      setTranslateProgress({ done, total });
    });

    setTranslating(false);
    setTranslateProgress(null);

    if (results.length === 0) {
      toast.error(t('studio_translate_failed'));
      return;
    }

    setDraft(prev => ({
      ...prev,
      sections: prev.sections.map(section => {
        let next = section;
        for (const { item, text } of results) {
          if (item.sectionId !== section.id) continue;
          // The mode decides where the machine output lands, and the model
          // decides whether that is allowed: applyAutoTranslation still
          // refuses to overwrite a locale a human reviewed.
          next = mode === 'auto_all'
            ? applyAutoTranslation(next, item.field, item.locale, text)
            : setSuggestion(next, item.field, item.locale, text);
        }
        return next;
      }),
    }));
    setDirty(true);
    toast.success(t('studio_translate_done', { n: results.length }));
  }, [translating, mode, draft, locale, selectedId, t]);

  /* ── Saving and publishing ────────────────────────────────── */

  function handle<T>(result: StudioResult<T>): result is { ok: true; value: T } {
    if (result.ok) return true;
    if (result.reason === 'UNAVAILABLE') toast.error(t('studio_unavailable'));
    else if (result.reason === 'FORBIDDEN') toast.error(t('general_error'));
    else toast.error(t('studio_error'));
    return false;
  }

  const save = useCallback(async () => {
    setSaving(true);
    const result = await saveDraft(slug, draft);
    setSaving(false);
    if (!handle(result)) return;
    setDirty(false);
    toast.success(t('studio_saved'));
  }, [slug, draft, t]);

  const publish = useCallback(async (note?: string) => {
    setSaving(true);
    // Publish means "make the stored draft live", so the draft in front of
    // the admin has to BE the stored draft. Saving first removes the gap
    // where an unsaved edit is visible but not what would go out.
    const saved = await saveDraft(slug, draft);
    if (!handle(saved)) { setSaving(false); return; }

    const result = await publishPage(slug, note);
    setSaving(false);
    if (!handle(result)) return;

    setDirty(false);
    toast.success(t('studio_published_ok', { n: result.value }));

    const reload = await loadPage(slug);
    if (reload.ok) {
      setRecord(reload.value.page);
      setVersions(reload.value.versions);
    }
  }, [slug, draft, t]);

  const restore = useCallback(async (version: number) => {
    const result = await restoreVersion(slug, version);
    if (!handle(result)) return;
    setDraft(result.value);
    setDirty(true);
    setSelectedId(null);
    toast.success(t('studio_restored', { n: version }));
  }, [slug, t]);

  const rollback = useCallback(async (version: number) => {
    setSaving(true);
    const result = await rollbackTo(slug, version);
    setSaving(false);
    if (!handle(result)) return;
    toast.success(t('studio_rolled_back', { n: version }));

    const reload = await loadPage(slug);
    if (reload.ok) {
      setRecord(reload.value.page);
      setVersions(reload.value.versions);
      setDraft(reload.value.page.draft);
      setDirty(false);
    }
  }, [slug, t]);

  return {
    slug, setSlug, loading, unavailable, record, versions,
    draft, dirty, selectedId, select: setSelectedId, selected,
    locale, setLocale, mode, setMode,
    editField,
    editSectionField, setVariant, setTheme, setSpacing, setEnabled, setMedia,
    move, addSection, duplicateSection, removeSection, setSeo,
    acceptSuggestion, rejectSuggestion, approveLocale,
    translating, translateProgress, runTranslation,
    saving, save, publish, restore, rollback,
  };
}

/** Section types an admin may add, for the "add block" control. */
export const ADDABLE = SECTION_DEFS.filter(d => d.repeatable);
