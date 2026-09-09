// ConfiguratorPanel — the customer decides what their renovation actually is.
//
// This is the difference between a calculator and a planner. A calculator
// prices everything the property could need at one quality level and produces
// a tidy, confident, wrong number. A planner asks.
//
// Three answers per decision, and the third is the one that matters:
//
//   Include        in the total
//   Skip           not in the total, and they said so
//   Not decided    not in the total, and they are TOLD
//
// The running summary never hides the third. A total that quietly omits the
// kitchen is worse than no total, because it looks finished.

import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLanguage } from '@/contexts/LanguageContext';
import { Check, Minus, HelpCircle } from 'lucide-react';
import {
  CATEGORY_ORDER,
  nodesForRooms,
  resolveSelection,
  roomKey,
  type Choice,
  type RoomKind,
  type Segment,
  type SelectionMap,
  type TaxonomyNode,
} from '@/renovation/configurator/selection';

const CHOICES: Choice[] = ['INCLUDE', 'EXCLUDE', 'NOT_DECIDED'];
const CHOICE_KEY: Record<Choice, string> = {
  INCLUDE: 'reno_cfg_include',
  EXCLUDE: 'reno_cfg_exclude',
  NOT_DECIDED: 'reno_cfg_undecided',
};
const SEGMENTS: Segment[] = ['ECONOMY', 'STANDARD', 'PREMIUM'];
const SEGMENT_KEY: Record<Segment, string> = {
  ECONOMY: 'reno_cfg_seg_economy',
  STANDARD: 'reno_cfg_seg_standard',
  PREMIUM: 'reno_cfg_seg_premium',
};

/** Taxonomy labels are data, not UI literals. A node may carry a translation
 * key; until it does, its own label is shown rather than a blank row. */
const labelOf = (t: (k: string) => string, node: TaxonomyNode) =>
  node.labelKey ? t(node.labelKey) : node.label;

function ChoiceToggle({
  value,
  onChange,
  t,
}: {
  value: Choice;
  onChange: (c: Choice) => void;
  t: (k: string) => string;
}) {
  return (
    <div className="inline-flex rounded-md border overflow-hidden shrink-0" role="group">
      {CHOICES.map((c) => {
        const active = value === c;
        const Icon = c === 'INCLUDE' ? Check : c === 'EXCLUDE' ? Minus : HelpCircle;
        return (
          <button
            key={c}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(c)}
            className={
              'px-2.5 py-1.5 text-xs flex items-center gap-1.5 transition-colors ' +
              (active
                ? c === 'INCLUDE'
                  ? 'bg-emerald-600 text-white'
                  : c === 'EXCLUDE'
                    ? 'bg-muted-foreground/80 text-white'
                    : 'bg-amber-500 text-white'
                : 'bg-background hover:bg-muted')
            }
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">{t(CHOICE_KEY[c])}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ConfiguratorPanel({
  rooms,
  selection,
  onChange,
}: {
  rooms: RoomKind[];
  selection: SelectionMap;
  onChange: (next: SelectionMap) => void;
}) {
  const { t } = useLanguage();

  const nodes = useMemo(() => nodesForRooms(rooms), [rooms]);
  const resolved = useMemo(() => resolveSelection(selection, undefined, rooms), [selection, rooms]);

  const groups = useMemo(() => {
    const out: { category: string; rows: { node: TaxonomyNode; room?: RoomKind }[] }[] = [];
    for (const cat of CATEGORY_ORDER) {
      const rows: { node: TaxonomyNode; room?: RoomKind }[] = [];
      for (const n of nodes.filter((x) => x.category === cat)) {
        if (n.scope === 'ROOM') {
          for (const r of (n.appliesTo ?? []).filter((r) => rooms.includes(r))) rows.push({ node: n, room: r });
        } else {
          rows.push({ node: n });
        }
      }
      if (rows.length) out.push({ category: cat, rows });
    }
    return out;
  }, [nodes, rooms]);

  const set = (key: string, patch: Partial<SelectionMap[string]>) =>
    onChange({ ...selection, [key]: { ...(selection[key] ?? { choice: 'NOT_DECIDED' }), ...patch } });

  return (
    <div className="space-y-4">
      {/* The running truth about the total, always visible. */}
      <Card className={resolved.isComplete ? '' : 'border-amber-300 dark:border-amber-800'}>
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="secondary">
              {t('reno_cfg_included')}: {resolved.includedItemKeys.length}
            </Badge>
            <Badge variant="outline">
              {t('reno_cfg_skipped')}: {resolved.excluded.length}
            </Badge>
            {resolved.undecided.length > 0 && (
              <Badge className="bg-amber-500 text-white hover:bg-amber-500">
                {t('reno_cfg_undecided')}: {resolved.undecided.length}
              </Badge>
            )}
            {resolved.selectedButNotPriced.length > 0 && (
              <Badge variant="outline">
                {t('reno_cfg_no_price')}: {resolved.selectedButNotPriced.length}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
            {resolved.isComplete ? t('reno_cfg_complete') : t('reno_cfg_incomplete')}
          </p>
        </CardContent>
      </Card>

      {groups.map((g) => (
        <Card key={g.category}>
          <CardContent className="pt-5 space-y-4">
            <h3 className="text-sm font-semibold tracking-wide text-muted-foreground">
              {t(`reno_cat_${g.category.toLowerCase()}`)}
            </h3>

            {g.rows.map(({ node, room }) => {
              const key = roomKey(node.id, room);
              const sel = selection[key] ?? { choice: node.defaultChoice, optionId: node.options[0]?.id };
              const chosen = node.options.find((o) => o.id === sel.optionId) ?? node.options[0];
              const unpriced = sel.choice === 'INCLUDE' && chosen && !chosen.itemKey;

              return (
                <div key={key} className="space-y-2 pb-3 border-b last:border-b-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium break-words">
                        {labelOf(t, node)}
                        {room ? (
                          <span className="text-muted-foreground font-normal">
                            {' '}
                            · {t(`room_${room.toLowerCase()}`)}
                          </span>
                        ) : null}
                      </p>
                      {node.hint ? (
                        <p className="text-xs text-muted-foreground mt-0.5 break-words">{node.hint}</p>
                      ) : null}
                    </div>
                    <ChoiceToggle value={sel.choice} onChange={(c) => set(key, { choice: c })} t={t} />
                  </div>

                  {sel.choice === 'INCLUDE' && (
                    <div className="flex flex-wrap gap-2">
                      {node.options.length > 1 && (
                        <Select value={chosen?.id} onValueChange={(v) => set(key, { optionId: v })}>
                          <SelectTrigger className="h-8 text-xs w-full sm:w-56">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {node.options.map((o) => (
                              <SelectItem key={o.id} value={o.id} className="text-xs">
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      <Select
                        value={sel.segment ?? 'STANDARD'}
                        onValueChange={(v) => set(key, { segment: v as Segment })}
                      >
                        <SelectTrigger className="h-8 text-xs w-full sm:w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SEGMENTS.map((s) => (
                            <SelectItem key={s} value={s} className="text-xs">
                              {t(SEGMENT_KEY[s])}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Chosen, real, and not in the total. Said plainly, next to
                      the thing it is about, rather than buried in a footnote. */}
                  {unpriced && (
                    <p className="text-xs text-amber-700 dark:text-amber-500 break-words">
                      {t('reno_cfg_no_price_note')}
                    </p>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Everything the customer has not priced, for the estimate screen to show
 * beside the total instead of pretending the total is the whole cost. */
export function NotInTheTotal({ selection, rooms }: { selection: SelectionMap; rooms: RoomKind[] }) {
  const { t } = useLanguage();
  const r = resolveSelection(selection, undefined, rooms);
  const items = [...r.undecided, ...r.selectedButNotPriced];
  if (!items.length) return null;
  return (
    <Card className="border-amber-300 dark:border-amber-800">
      <CardContent className="pt-5 space-y-2">
        <h3 className="text-sm font-semibold">{t('reno_cfg_not_in_total')}</h3>
        <ul className="space-y-1 list-disc ps-5">
          {items.map((x) => (
            <li key={x.id} className="text-sm break-words">
              {x.label}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
