import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  loadPage, saveDraft, publishPage, restoreVersion, rollbackTo,
  type PageSlug, type SitePageRecord, type StudioResult,
} from '@/services/siteContent';
import {
  DEFAULT_TRANSLATION_MODE, type Locale, type SitePageContent, type SiteSection,
  type SiteVersion, type TranslationMode,
  type FieldHost,
  type SectionStyle, type StyleAxis,
  defaultStyle,
  applyAutoTranslation, applySuggestion, dismissSuggestion, duplicateSection as duplicate,
  editLocale, insertSectionAfter,
  emptyPage, makeSection, markReviewed, moveSection, onItem, setSectionEnabled,
  setSuggestion, translationTargets,
  addItem as addChild, duplicateItem as duplicateChild, editItemField,
  moveItem as moveChild, removeItem as removeChild, setItemIcon, setSectionIcon,
  orderSections, orderItems,
} from '@/site/model';
import { SECTION_DEFS, itemsDef, sectionDef } from '@/site/registry';
import {
  type History, canRedo, canUndo, emptyHistory, record as recordStep, redo as redoStep,
  undo as undoStep,
} from '@/site/history';
import { defaultOrderFor } from '@/site/render/order';
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
  /*
   * The page's OWN running order, asked of the one place that knows it.
   *
   * This used to be `slug === 'about' ? about : home`, which was correct
   * while there were two pages and silently wrong the moment there were
   * seven: opening Pricing seeded it with the home page's twelve
   * sections, so the editor showed the wrong page and a save would have
   * published it.
   */
  const order = defaultOrderFor(slug);
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

  /** Step back and forward through this session's edits. */
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Throw away every unsaved edit and return to the loaded draft. */
  discard: () => void;

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
  /**
   * One axis of the selected section's style preset.
   *
   * Typed against STYLE_AXES rather than against `string`, so a control that
   * offers a step the vocabulary does not have is a compile error instead of
   * a stored value that normalizePage silently throws away on the next load.
   */
  setStyle: <K extends StyleAxis>(axis: K, value: SectionStyle[K]) => void;
  setEnabled: (enabled: boolean, id?: string) => void;
  setMedia: (slot: string, url: string | null, alt?: string, atSection?: string) => void;

  /* ── A section's repeated children ──────────────────────────── */

  /** Edit one localized field of one child, named by identity. */
  editItemText: (
    sectionId: string, itemId: string, field: string, value: string, atLocale?: Locale,
  ) => void;
  /** Add a child, optionally directly after another. Refused past `max`. */
  addItem: (sectionId: string, afterId?: string) => void;
  removeItem: (sectionId: string, itemId: string) => void;
  moveItem: (sectionId: string, itemId: string, delta: number) => void;
  /** The order a drag produced, applied whole. See orderItems(). */
  orderChildren: (sectionId: string, ids: readonly string[]) => void;
  duplicateItem: (sectionId: string, itemId: string) => void;
  /** Choose an icon by NAME. `null` returns the slot to the section default. */
  setIcon: (slot: string, name: string | null, itemId?: string) => void;

  move: (id: string, delta: number) => void;
  /** The order a drag produced, applied whole. See orderSections(). */
  orderSectionIds: (ids: readonly string[]) => void;
  addSection: (type: string, afterId?: string) => void;
  /** Copy a repeatable section, with its content, directly below itself. */
  duplicateSection: (id: string) => void;
  removeSection: (id: string) => void;
  setSeo: (patch: Partial<SitePageContent['seo']>) => void;

  /* Reviewing a translation. `itemId` names a repeated child, because a
     card's Arabic needs approving exactly as the heading's does. */
  acceptSuggestion: (field: string, locale: Locale, itemId?: string) => void;
  rejectSuggestion: (field: string, locale: Locale, itemId?: string) => void;
  approveLocale: (field: string, locale: Locale, itemId?: string) => void;

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

  /*
   * UNDO AND REDO.
   *
   * Snapshots of the whole page, because an edit replaces the whole page
   * object anyway. See site/history.ts for why this is not an operation
   * log: there is no "invert a duplicate" or "invert a locale-scoped
   * text edit" to get subtly wrong.
   */
  const [history, setHistory] = useState<History<SitePageContent>>(emptyHistory);

  /**
   * The ONE way an edit reaches the draft.
   *
   * Every mutation used to call setDraft directly — twelve call sites,
   * each of which would have had to remember to record a step, and the
   * thirteenth would not have. Recording here means a new editing action
   * is undoable by construction rather than by discipline.
   *
   * Loading and saving deliberately do NOT come through here: replacing
   * the page with what the server returned is not a step to step back
   * through.
   */
  const edit = useCallback((fn: (prev: SitePageContent) => SitePageContent) => {
    setDraft(prev => {
      const next = fn(prev);
      // A no-op edit — committing a field to the value it already held —
      // must not consume an undo step.
      if (next === prev) return prev;
      setHistory(h => recordStep(h, prev));
      setDirty(true);
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    setDraft(present => {
      const step = undoStep(historyRef.current, present);
      if (!step) return present;
      setHistory(step.history);
      setDirty(true);
      return step.present;
    });
  }, []);

  const redo = useCallback(() => {
    setDraft(present => {
      const step = redoStep(historyRef.current, present);
      if (!step) return present;
      setHistory(step.history);
      setDirty(true);
      return step.present;
    });
  }, []);
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

  /* Read inside the setDraft updater, which cannot close over state. */
  const historyRef = useRef(history);
  historyRef.current = history;

  const selected = useMemo(
    () => draft.sections.find(s => s.id === selectedId) ?? null,
    [draft.sections, selectedId],
  );

  /** Replace one section, leaving the rest of the page identical. */
  const patch = useCallback((id: string, fn: (s: SiteSection) => SiteSection) => {
    edit(prev => ({
      ...prev,
      sections: prev.sections.map(s => (s.id === id ? fn(s) : s)),
    }));
  }, [edit]);

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

  const setStyle = useCallback(<K extends StyleAxis>(axis: K, value: SectionStyle[K]) => {
    if (!selectedId) return;
    /* Merged onto defaultStyle rather than onto whatever is stored: a section
       saved before presets existed has no style object at all, and spreading
       undefined would produce a style with one axis in it. */
    patch(selectedId, s => ({
      ...s,
      style: { ...defaultStyle(), ...(s.style ?? {}), [axis]: value },
    }));
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
    edit(prev => setSectionEnabled(prev, target, enabled));
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

  /* ── Repeated children ────────────────────────────────────── */

  /**
   * The child's own locale, for the same reason the section's field edit
   * takes one: the commit fires on blur, and by then the admin may have
   * switched language, which is itself a blur.
   */
  const editItemText = useCallback((
    sectionId: string, itemId: string, field: string, value: string, atLocale?: Locale,
  ) => {
    patch(sectionId, s => editItemField(s, itemId, field, atLocale ?? locale, value));
  }, [locale, patch]);

  /**
   * Add a child.
   *
   * `max` comes from the registry and is a DESIGN limit, not a storage one:
   * past it the block stops looking like the thing it was designed as. Being
   * refused with a message is better than discovering that at the tenth card.
   */
  const addItem = useCallback((sectionId: string, afterId?: string) => {
    const section = draft.sections.find(x => x.id === sectionId);
    const def = section ? itemsDef(section.type) : undefined;
    if (!section || !def) return;
    if (section.items.length >= def.max) {
      toast.info(t('studio_item_max', { n: def.max }));
      return;
    }
    patch(sectionId, s => addChild(s, `item-${crypto.randomUUID().slice(0, 8)}`, afterId));
  }, [draft.sections, patch, t]);

  const removeItem = useCallback((sectionId: string, itemId: string) => {
    patch(sectionId, s => removeChild(s, itemId));
  }, [patch]);

  const moveItem = useCallback((sectionId: string, itemId: string, delta: number) => {
    patch(sectionId, s => moveChild(s, itemId, delta));
  }, [patch]);

  const duplicateItem = useCallback((sectionId: string, itemId: string) => {
    const section = draft.sections.find(x => x.id === sectionId);
    const def = section ? itemsDef(section.type) : undefined;
    if (!section || !def) return;
    if (section.items.length >= def.max) {
      toast.info(t('studio_item_max', { n: def.max }));
      return;
    }
    patch(sectionId, s => duplicateChild(s, itemId, `item-${crypto.randomUUID().slice(0, 8)}`));
  }, [draft.sections, patch, t]);

  /**
   * Choose an icon.
   *
   * A NAME, never markup -- see src/site/icons.ts for why that is the whole
   * safety argument for making icons editable at all. Clearing returns the
   * slot to whatever the component ships, which is why null is a value here
   * rather than an empty string.
   */
  const setIcon = useCallback((slot: string, name: string | null, itemId?: string) => {
    if (!selectedId) return;
    patch(selectedId, s => (itemId
      ? setItemIcon(s, itemId, slot, name)
      : setSectionIcon(s, slot, name)));
  }, [selectedId, patch]);

  const move = useCallback((id: string, delta: number) => {
    edit(prev => moveSection(prev, id, delta));
    setDirty(true);
  }, []);

  /*
   * WHAT A DRAG REPORTS.
   *
   * Not "moved from 4 to 2" — the whole order it produced. A drag can cross
   * several rows, can be cancelled halfway, and can land between two rows
   * that both moved while it was in flight; turning that into a delta is
   * arithmetic that is wrong in exactly the cases nobody tests. The model
   * validates the list as a permutation and refuses anything else, so a
   * stale drag is a no-op rather than a way to lose a section.
   */
  const orderSectionIds = useCallback((ids: readonly string[]) => {
    edit(prev => orderSections(prev, ids));
    setDirty(true);
  }, []);

  const orderChildren = useCallback((sectionId: string, ids: readonly string[]) => {
    patch(sectionId, s => orderItems(s, ids));
  }, [patch]);

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
    const group = def.items;

    edit(prev => {
      const next = insertSectionAfter(prev, type, id, afterId);
      if (!group) return next;
      /*
       * A block that repeats arrives with children.
       *
       * Added empty, it is a heading over nothing: there is no card to type
       * into, and the fact that it repeats at all is hidden behind a control
       * the admin has to go and find. Three empty cards show what the block
       * is on the first press, and deleting one is a single click.
       */
      return {
        ...next,
        sections: next.sections.map(s => {
          if (s.id !== id) return s;
          let seeded = s;
          for (let i = 0; i < group.seed; i += 1) {
            seeded = addChild(seeded, `item-${crypto.randomUUID().slice(0, 8)}`);
          }
          return seeded;
        }),
      };
    });
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
    edit(prev => {
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
    edit(prev => ({ ...prev, sections: prev.sections.filter(s => s.id !== id) }));
    setDirty(true);
    setSelectedId(null);
  }, [draft.sections]);

  const setSeo = useCallback((p: Partial<SitePageContent['seo']>) => {
    edit(prev => ({ ...prev, seo: { ...prev.seo, ...p } }));
    setDirty(true);
  }, []);

  /* ── Translation review ───────────────────────────────────── */

  /**
   * The three review actions, for a section or for one of its children.
   *
   * `review` exists so the three cannot drift: each is the same "act on a
   * field host, which is either the section or the child named by itemId",
   * differing only in which model function does the acting.
   */
  const review = useCallback((
    fn: <T extends FieldHost>(host: T, field: string, locale: Locale) => T,
  ) => (field: string, target: Locale, itemId?: string) => {
    if (!selectedId) return;
    patch(selectedId, s => (itemId
      ? onItem(s, itemId, child => fn(child, field, target))
      : fn(s, field, target)));
  }, [selectedId, patch]);

  const acceptSuggestion = useMemo(() => review(applySuggestion), [review]);
  const rejectSuggestion = useMemo(() => review(dismissSuggestion), [review]);
  const approveLocale = useMemo(() => review(markReviewed), [review]);

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

    /* A translation run is one undoable step: it can rewrite every
       locale of every field, which is exactly the change somebody is
       most likely to want back in one press. */
    edit(prev => ({
      ...prev,
      sections: prev.sections.map(section => {
        let next = section;
        for (const { item, text } of results) {
          if (item.sectionId !== section.id) continue;
          /*
           * The mode decides where the machine output lands, and the model
           * decides whether that is allowed: applyAutoTranslation still
           * refuses to overwrite a locale a human reviewed.
           *
           * A target that names a child is applied TO that child. Both
           * branches call the same two functions -- the rules for a card are
           * the rules for the heading above it, reached through onItem.
           */
          const write = <T extends FieldHost>(host: T): T => (
            mode === 'auto_all'
              ? applyAutoTranslation(host, item.field, item.locale, text)
              : setSuggestion(host, item.field, item.locale, text)
          );
          next = item.itemId ? onItem(next, item.itemId, write) : write(next);
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

  /**
   * Throw the session away.
   *
   * Back to what the server last gave us, which is what `save` would
   * otherwise have to be undone repeatedly to reach. History is cleared
   * with it: stepping back INTO discarded work would make discard a lie.
   */
  const discard = useCallback(() => {
    const base = record?.draft;
    setDraft(base && base.sections.length > 0 ? base : seedPage(slug));
    setHistory(emptyHistory());
    setDirty(false);
    setSelectedId(null);
  }, [record, slug]);

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
    draft, dirty,
    undo, redo, canUndo: canUndo(history), canRedo: canRedo(history), discard, selectedId, select: setSelectedId, selected,
    locale, setLocale, mode, setMode,
    editField,
    editSectionField, setVariant, setTheme, setSpacing, setStyle, setEnabled, setMedia,
    editItemText, addItem, removeItem, moveItem, orderChildren, duplicateItem, setIcon,
    move, orderSectionIds, addSection, duplicateSection, removeSection, setSeo,
    acceptSuggestion, rejectSuggestion, approveLocale,
    translating, translateProgress, runTranslation,
    saving, save, publish, restore, rollback,
  };
}

/** Section types an admin may add, for the "add block" control. */
export const ADDABLE = SECTION_DEFS.filter(d => d.repeatable);
