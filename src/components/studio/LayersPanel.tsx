import React, { useMemo, useState } from 'react';
import { Reorder, useDragControls } from 'motion/react';
import {
  ChevronDown, ChevronRight, Copy, Eye, EyeOff, GripVertical, Plus, Trash2, Type,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { itemsDef, sectionDef } from '@/site/registry';
import { localeState, type SiteSection } from '@/site/model';
import type { StudioState } from './useStudioState';
import { StateDot } from './StateDot';
import { SectionLibrary } from './SectionLibrary';

/**
 * THE PAGE AS A TREE, AND A REAL DRAG.
 *
 * WHAT THIS REPLACED
 *
 * A flat list with up and down arrows. Arrows are a fine keyboard affordance
 * and a poor way to move a section five places: it is five presses, each one
 * re-rendering the list under the cursor, with no sense of where the thing
 * will land. They were also the only ordering the editor had, and calling
 * that drag-and-drop would have been a lie.
 *
 * WHY motion/react AND NOT A NEW DEPENDENCY
 *
 * `motion` is already a dependency of this application, and its `Reorder`
 * primitive is a mature, maintained implementation of exactly this: pointer
 * and touch, a live preview that IS the row rather than a ghost of it,
 * neighbours that animate out of the way so the drop target is never in
 * doubt, and a keyboard-reachable alternative left intact underneath. Adding
 * a second drag library to get the same behaviour would be weight for nothing.
 *
 * A drag is started only from the handle (`useDragControls`), so clicking a
 * row still selects it and a click-drag on the label does not start a move by
 * accident.
 *
 * WHAT THE TREE SHOWS
 *
 *   Page
 *     Section            — drag, select, hide, duplicate, delete
 *       Text             — the section's own fields, selectable
 *       Cards            — repeated children: drag WITHIN the section
 *
 * Children reorder inside their own section and cannot be dragged into
 * another one. That is a deliberate limit rather than a missing feature: a
 * card belongs to a block whose registry entry defines its fields, and a FAQ
 * answer dropped into a feature grid has nowhere to put its words.
 */
export function LayersPanel({ studio }: { studio: StudioState }) {
  const { t } = useLanguage();
  const {
    draft, selectedId, select, setEnabled, addSection, duplicateSection,
    removeSection, orderSectionIds, locale,
  } = studio;

  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [library, setLibrary] = useState(false);

  /* Reorder.Group works on values; ids are the stable identity the model
     already uses, so the list it hands back is exactly what orderSections()
     validates. */
  const ids = useMemo(() => draft.sections.map(s => s.id), [draft.sections]);

  return (
    <div className="flex h-full flex-col" data-studio-layers>
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{t('studio_layers')}</h2>
        <span className="truncate text-[13px] text-muted-foreground">{t('studio_drag_hint')}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <p className="px-2 pb-1 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {t('studio_layers_page')}
        </p>

        <Reorder.Group
          axis="y"
          values={ids}
          onReorder={orderSectionIds}
          as="ul"
          className="space-y-0.5"
        >
          {draft.sections.map(section => (
            <SectionRow
              key={section.id}
              section={section}
              studio={studio}
              locale={locale}
              selected={section.id === selectedId}
              expanded={!!open[section.id]}
              onToggle={() => setOpen(o => ({ ...o, [section.id]: !o[section.id] }))}
              onSelect={() => select(section.id)}
              onVisibility={() => { select(section.id); setEnabled(!section.enabled, section.id); }}
              onDuplicate={() => duplicateSection(section.id)}
              onRemove={() => removeSection(section.id)}
            />
          ))}
        </Reorder.Group>
      </div>

      <div className="border-t p-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-[16px]"
          onClick={() => setLibrary(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          {t('studio_add_block')}
        </Button>
      </div>

      {library && (
        <SectionLibrary
          onClose={() => setLibrary(false)}
          onPick={(type) => {
            // Below the selected section when there is one, so the new block
            // lands where the admin is working rather than at the bottom of a
            // page they then have to scroll to.
            addSection(type, selectedId ?? undefined);
            setLibrary(false);
          }}
        />
      )}
    </div>
  );
}

function SectionRow({
  section, studio, locale, selected, expanded,
  onToggle, onSelect, onVisibility, onDuplicate, onRemove,
}: {
  section: SiteSection;
  studio: StudioState;
  locale: string;
  selected: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onVisibility: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const { t } = useLanguage();
  const controls = useDragControls();
  const def = sectionDef(section.type);
  const kids = itemsDef(section.type);

  /* Does anything in this section need a look in the language the admin is
     currently editing? The dot is the whole answer. */
  let worst: 'current' | 'needs_update' | 'ai_suggested' | 'reviewed' = 'current';
  const note = (state: typeof worst) => {
    if (state === 'needs_update') worst = 'needs_update';
    else if (state === 'ai_suggested' && worst !== 'needs_update') worst = 'ai_suggested';
  };
  for (const f of def?.fields ?? []) note(localeState(section, f.key, locale as never));
  for (const item of section.items) {
    for (const f of def?.items?.fields ?? []) note(localeState(item, f.key, locale as never));
  }

  const hasChildren = (def?.fields?.length ?? 0) > 0 || section.items.length > 0;

  return (
    <Reorder.Item
      value={section.id}
      dragListener={false}
      dragControls={controls}
      as="li"
      /* Lifted while it travels, so the row being moved is unmistakably the
         one under the pointer. */
      whileDrag={{ scale: 1.02, zIndex: 30, boxShadow: '0 12px 28px hsl(0 0% 0% / 0.18)' }}
      className="rounded-md bg-card"
    >
      <div
        className={`group flex items-center gap-1 rounded-md px-1 py-1.5 ${
          selected ? 'bg-gold-soft' : 'hover:bg-accent/50'
        }`}
      >
        {/* THE HANDLE. Dragging starts here and nowhere else, so a click on
            the label still selects and a drag across the text selects text. */}
        <button
          type="button"
          aria-label={t('studio_drag')}
          onPointerDown={(e) => controls.start(e)}
          className="grid h-7 w-5 shrink-0 cursor-grab touch-none place-items-center rounded text-muted-foreground hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          aria-label={expanded ? t('studio_collapse') : t('studio_expand')}
          aria-expanded={expanded}
          onClick={onToggle}
          disabled={!hasChildren}
          className="grid h-7 w-5 shrink-0 place-items-center rounded text-muted-foreground disabled:opacity-30"
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>

        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 flex-1 items-center gap-2 text-start"
        >
          <StateDot state={worst} />
          <span
            className={`min-w-0 flex-1 truncate text-[16px] ${
              section.enabled ? '' : 'text-muted-foreground line-through'
            }`}
          >
            {def ? t(def.labelKey) : section.type}
          </span>
        </button>

        <div className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <Button
            variant="ghost" size="icon" className="h-7 w-7"
            onClick={onVisibility}
            aria-label={t('studio_enabled')}
          >
            {section.enabled
              ? <Eye className="h-3.5 w-3.5" />
              : <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />}
          </Button>
          {def?.repeatable && (
            <>
              <Button
                variant="ghost" size="icon" className="h-7 w-7"
                onClick={onDuplicate}
                aria-label={t('studio_duplicate')}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost" size="icon" className="h-7 w-7"
                onClick={onRemove}
                aria-label={t('studio_delete')}
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </>
          )}
        </div>
      </div>

      {expanded && (
        <div className="ms-6 border-s ps-2">
          {/* The section's own words. Selecting one selects the section and
              scrolls the inspector to it, which is the closest thing to
              "click the heading in the tree" the field model allows. */}
          {(def?.fields?.length ?? 0) > 0 && (
            <button
              type="button"
              onClick={() => studio.select(section.id)}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-start text-[15px] text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            >
              <Type className="h-3 w-3 shrink-0" />
              <span className="truncate">{t('studio_layer_fields')} · {def?.fields.length}</span>
            </button>
          )}

          {section.items.length > 0 && kids && (
            <ChildList section={section} studio={studio} label={t('studio_layer_cards')} />
          )}
        </div>
      )}
    </Reorder.Item>
  );
}

/**
 * A section's repeated children, dragged within their own section.
 *
 * The label is the child's first text field in the working language, because
 * "Card" seven times is not a tree — it is a list of identical rows a person
 * then has to click through to find the one they meant.
 */
function ChildList({
  section, studio, label,
}: { section: SiteSection; studio: StudioState; label: string }) {
  const { t } = useLanguage();
  const { orderChildren, locale, removeItem, duplicateItem, addItem } = studio;
  const kids = itemsDef(section.type);
  const ids = useMemo(() => section.items.map(i => i.id), [section.items]);

  const nameOf = (item: SiteSection['items'][number]) => {
    for (const f of kids?.fields ?? []) {
      const value: unknown = item.content?.[f.key]?.[locale];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return kids ? t(kids.itemLabelKey) : label;
  };

  return (
    <>
      <p className="px-2 pt-1 text-[13px] uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      <Reorder.Group axis="y" values={ids} onReorder={(next) => orderChildren(section.id, next)} as="ul">
        {section.items.map(item => (
          <ChildRow
            key={item.id}
            id={item.id}
            name={nameOf(item)}
            onRemove={() => removeItem(section.id, item.id)}
            onDuplicate={() => duplicateItem(section.id, item.id)}
            onSelect={() => studio.select(section.id)}
          />
        ))}
      </Reorder.Group>
      <Button
        variant="ghost" size="sm"
        className="mt-0.5 h-7 w-full justify-start gap-1.5 px-2 text-[15px]"
        onClick={() => addItem(section.id)}
      >
        <Plus className="h-3 w-3" /> {t('studio_item_add')}
      </Button>
    </>
  );
}

function ChildRow({
  id, name, onRemove, onDuplicate, onSelect,
}: {
  id: string; name: string;
  onRemove: () => void; onDuplicate: () => void; onSelect: () => void;
}) {
  const { t } = useLanguage();
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={id}
      dragListener={false}
      dragControls={controls}
      as="li"
      whileDrag={{ scale: 1.02, zIndex: 30, boxShadow: '0 8px 20px hsl(0 0% 0% / 0.16)' }}
      className="group flex items-center gap-1 rounded bg-card px-1 py-0.5 hover:bg-accent/50"
    >
      <button
        type="button"
        aria-label={t('studio_drag')}
        onPointerDown={(e) => controls.start(e)}
        className="grid h-6 w-4 shrink-0 cursor-grab touch-none place-items-center rounded text-muted-foreground hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="h-3 w-3" />
      </button>
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 truncate py-1 text-start text-[15px]">
        {name}
      </button>
      <div className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onDuplicate} aria-label={t('studio_item_duplicate')}>
          <Copy className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onRemove} aria-label={t('studio_item_remove')}>
          <Trash2 className="h-3 w-3 text-destructive" />
        </Button>
      </div>
    </Reorder.Item>
  );
}
