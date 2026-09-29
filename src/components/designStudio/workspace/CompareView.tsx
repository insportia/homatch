// COMPARE — two versions of the same space, from the same camera.
//
// Side by side, as a slider over one image, or as a quick A/B toggle. The
// cameras are locked together: whichever side the customer orbits, the other
// follows exactly, because a difference seen from two different angles is
// not a difference anybody can judge.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Columns2, Loader2, SplitSquareHorizontal, ToggleLeft, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { CatalogAsset, CatalogMaterial } from '@/lib/designStudio/catalog';
import { normalizeDesignState, type DesignState } from '@/lib/designStudio/designState';
import type { SpaceModel } from '@/lib/designStudio/space';
import type { DesignVersionRecord } from '@/lib/designStudio/types';
import { diffDesigns, isEmptyDiff } from '@/lib/designStudio/versioning';
import { assetsByCode } from '@/services/designStudio/catalog';
import { getVersion } from '@/services/designStudio/projects';
import { cn } from '@/lib/utils';
import { DesignCanvas } from '../canvas/DesignCanvas';
import type { CameraSnapshot, SceneController } from '../canvas/SceneController';

type Mode = 'SIDE' | 'SLIDER' | 'TOGGLE';

export function CompareView({
  space, versions, leftId, assets: baseAssets, materials, camera, loadModel, onClose,
}: {
  space: SpaceModel | null;
  versions: DesignVersionRecord[];
  leftId: string;
  assets: Map<string, CatalogAsset>;
  materials: Map<string, CatalogMaterial>;
  camera: CameraSnapshot | null;
  loadModel?: (c: SceneController) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const phone = typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 1023px)').matches;
  const [mode, setMode] = useState<Mode>(phone ? 'TOGGLE' : 'SIDE');
  const [left, setLeft] = useState(leftId);
  const [right, setRight] = useState(() => versions.find((v) => v.id !== leftId)?.id ?? leftId);
  const [states, setStates] = useState<Record<string, DesignState>>({});
  const [assets, setAssets] = useState(baseAssets);
  const [showing, setShowing] = useState<'A' | 'B'>('A');
  const [split, setSplit] = useState(50);
  const controllers = useRef<{ A: SceneController | null; B: SceneController | null }>({ A: null, B: null });
  const syncing = useRef(false);

  // Load both states (and any piece either references that is not loaded yet).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const need = [left, right].filter((id) => !states[id]);
      if (!need.length) return;
      const loaded = await Promise.all(need.map((id) => getVersion(id)));
      const next: Record<string, DesignState> = {};
      loaded.forEach((v, i) => { if (v) next[need[i]] = normalizeDesignState(v.state); });
      const missing = Object.values(next).flatMap((s) => s.objects.map((o) => o.assetId)).filter((c) => !assets.has(c));
      if (missing.length) {
        const extra = await assetsByCode(missing);
        if (!cancelled && extra.length) setAssets((m) => new Map([...m, ...extra.map((a) => [a.code, a] as const)]));
      }
      if (!cancelled) setStates((s) => ({ ...s, ...next }));
    })().catch(() => { /* a failed load shows the spinner; nothing is changed */ });
    return () => { cancelled = true; };
  }, [left, right, states, assets]);

  useEffect(() => {
    if (states[left]) controllers.current.A?.applyDesign(states[left], assets, materials);
  }, [states, left, assets, materials]);
  useEffect(() => {
    if (states[right]) controllers.current.B?.applyDesign(states[right], assets, materials);
  }, [states, right, assets, materials]);

  // One camera for both: whichever moves drives the other.
  const link = (side: 'A' | 'B', c: SceneController) => {
    controllers.current[side] = c;
    const state = side === 'A' ? states[left] : states[right];
    if (state) c.applyDesign(state, assets, materials);
    c.controls.addEventListener('change', () => {
      if (syncing.current) return;
      const other = controllers.current[side === 'A' ? 'B' : 'A'];
      if (!other) return;
      syncing.current = true;
      other.restore(c.snapshot(), false);
      syncing.current = false;
    });
  };

  const diff = useMemo(() => (states[left] && states[right] ? diffDesigns(states[left], states[right]) : null), [states, left, right]);
  const name = (id: string) => versions.find((v) => v.id === id)?.name ?? '';
  const ready = !!states[left] && !!states[right];

  const summary = diff ? (isEmptyDiff(diff) ? [t('ds_compare_same')] : [
    diff.objectsAdded ? t('ds_diff_added', { n: String(diff.objectsAdded) }) : null,
    diff.objectsRemoved ? t('ds_diff_removed', { n: String(diff.objectsRemoved) }) : null,
    diff.objectsReplaced ? t('ds_diff_replaced', { n: String(diff.objectsReplaced) }) : null,
    diff.objectsMoved ? t('ds_diff_moved', { n: String(diff.objectsMoved) }) : null,
    diff.objectsRestyled ? t('ds_diff_restyled', { n: String(diff.objectsRestyled) }) : null,
    diff.surfacesChanged ? t('ds_diff_surfaces', { n: String(diff.surfacesChanged) }) : null,
    diff.lightingChanged ? t('ds_diff_lighting') : null,
  ].filter(Boolean) as string[]) : [];

  const select = (value: string, onChange: (v: string) => void, label: string) => (
    <label className="flex min-w-0 items-center gap-2 text-[13px] text-white/70">
      <span className="shrink-0">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 min-w-0 max-w-[14rem] rounded-md border border-white/15 bg-[#101623] px-2 text-[14px] text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]"
      >
        {versions.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
    </label>
  );

  const canvas = (side: 'A' | 'B', className: string, style?: React.CSSProperties) => (
    <div className={className} style={style}>
      <DesignCanvas
        space={space}
        loadModel={loadModel}
        selection={null}
        onPick={() => {}}
        onReady={(c) => link(side, c)}
        initialCamera={camera}
      />
    </div>
  );

  return (
    <div role="dialog" aria-modal="true" aria-label={t('ds_compare_title')} className="fixed inset-0 z-50 flex flex-col bg-[#0C1119] text-white">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/10 px-3 py-2.5">
        <h2 className="font-display text-[15px] font-semibold">{t('ds_compare_title')}</h2>
        {select(left, setLeft, 'A')}
        {select(right, setRight, 'B')}
        <div role="radiogroup" aria-label={t('ds_compare_mode')} className="flex gap-1 rounded-lg bg-white/5 p-1">
          {([['SIDE', Columns2, 'ds_compare_side'], ['SLIDER', SplitSquareHorizontal, 'ds_compare_slider'], ['TOGGLE', ToggleLeft, 'ds_compare_toggle']] as const).map(([m, Icon, key]) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={cn('inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]',
                mode === m ? 'bg-white text-[#0C1119]' : 'text-white/80 hover:text-white', m === 'SIDE' && 'hidden lg:inline-flex')}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />{t(key)}
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose} className="ms-auto grid h-9 w-9 place-items-center rounded-lg hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]" aria-label={t('ds_action_close')}>
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </header>
      <p className="border-b border-white/10 px-3 py-2 text-[13px] text-white/75" aria-live="polite">
        <span className="font-semibold text-white">{t('ds_compare_b_vs_a', { b: name(right), a: name(left) })}</span>
        {summary.length ? ` · ${summary.join(' · ')}` : null}
      </p>

      <div className="relative min-h-0 flex-1 bg-[#DFE3E8]">
        {!ready ? (
          <div className="absolute inset-0 z-10 grid place-items-center text-[#0C1119]">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          </div>
        ) : null}
        {mode === 'SIDE' ? (
          <div className="grid h-full grid-cols-2 gap-px bg-white/20">
            <div className="relative">
              {canvas('A', 'absolute inset-0')}
              <span className="pointer-events-none absolute start-3 top-3 rounded-md bg-[#0C1119] px-2 py-1 text-[13px] font-semibold">A · {name(left)}</span>
            </div>
            <div className="relative">
              {canvas('B', 'absolute inset-0')}
              <span className="pointer-events-none absolute start-3 top-3 rounded-md bg-[hsl(38_92%_54%)] px-2 py-1 text-[13px] font-semibold text-[#161309]">B · {name(right)}</span>
            </div>
          </div>
        ) : mode === 'SLIDER' ? (
          <div className="relative h-full" dir="ltr">
            {canvas('A', 'absolute inset-0')}
            {canvas('B', 'absolute inset-0', { clipPath: `inset(0 0 0 ${split}%)` })}
            <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-[hsl(38_92%_54%)]" style={{ left: `${split}%` }} aria-hidden="true" />
            <span className="pointer-events-none absolute left-3 top-3 rounded-md bg-[#0C1119] px-2 py-1 text-[13px] font-semibold">A</span>
            <span className="pointer-events-none absolute right-3 top-3 rounded-md bg-[hsl(38_92%_54%)] px-2 py-1 text-[13px] font-semibold text-[#161309]">B</span>
            <input
              type="range" min={5} max={95} value={split} onChange={(e) => setSplit(Number(e.target.value))}
              aria-label={t('ds_compare_slider')}
              className="absolute inset-x-6 bottom-4 accent-[hsl(38_92%_50%)]"
            />
          </div>
        ) : (
          <div className="relative h-full">
            {canvas('A', cn('absolute inset-0', showing === 'A' ? 'visible' : 'invisible'))}
            {canvas('B', cn('absolute inset-0', showing === 'B' ? 'visible' : 'invisible'))}
            <div className="absolute inset-x-0 bottom-4 flex justify-center">
              <div role="radiogroup" aria-label={t('ds_compare_toggle')} className="flex gap-1 rounded-xl bg-[#0C1119] p-1 shadow-lg">
                {(['A', 'B'] as const).map((side) => (
                  <button key={side} type="button" role="radio" aria-checked={showing === side} onClick={() => setShowing(side)}
                    className={cn('min-w-24 rounded-lg px-3 py-2 text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]',
                      showing === side ? (side === 'A' ? 'bg-white text-[#0C1119]' : 'bg-[hsl(38_92%_54%)] text-[#161309]') : 'text-white/80')}>
                    {side} · {name(side === 'A' ? left : right)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
