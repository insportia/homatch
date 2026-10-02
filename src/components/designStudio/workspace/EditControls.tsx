import React, { useMemo, useState } from 'react';
import { Copy, Eye, EyeOff, Lock, Replace, RotateCcw, RotateCw, Trash2, Unlock } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { CatalogAsset, CatalogMaterial, Palette } from '@/lib/designStudio/catalog';
import type { DesignState, ObjectInstance } from '@/lib/designStudio/designState';
import type { PlacementIssue } from '@/lib/designStudio/placement';
import { parseSurfaceId, type SpaceModel } from '@/lib/designStudio/space';
import type { ModelPart } from '@/lib/designStudio/modelParts';
import { cn } from '@/lib/utils';
import { ColorPicker, MaterialList, Swatch } from './SurfacePanels';

const ISSUE_KEY: Record<string, string> = {
  BLOCKS_DOOR: 'ds_issue_blocks_door',
  ON_STAIRS: 'ds_issue_on_stairs',
  BLOCKS_STAIRS: 'ds_issue_blocks_stairs',
  OVERLAPS_OBJECT: 'ds_issue_overlaps',
  TIGHT_ACCESS: 'ds_issue_tight',
  THROUGH_WALL: 'ds_issue_through_wall',
  OUTSIDE_ROOM: 'ds_issue_outside',
  NO_ROOM: 'ds_issue_outside',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-[#EEF0F3] pt-3">
      <h3 className="mb-2 text-2xs font-semibold uppercase tracking-[0.12em] text-[#4A5263]">{title}</h3>
      {children}
    </section>
  );
}

const ACTION =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-[#D5D9E0] px-2.5 text-[13px] font-medium text-[#0C1119] '
  + 'hover:bg-[#F4F5F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] disabled:opacity-40 disabled:pointer-events-none';

/** Fit findings, stated concretely — never a score. */
export function FitFindings({ issues, estimated }: { issues: PlacementIssue[]; estimated: boolean }) {
  const { t } = useLanguage();
  const unique = [...new Set(issues.map((i) => i.code))];
  return (
    <div className="space-y-1.5">
      {unique.length === 0 ? (
        <p className="text-[14px] font-medium text-[hsl(152_54%_28%)]">{t('ds_fit_clear')}</p>
      ) : unique.map((code) => (
        <p key={code} className="text-[14px] font-medium text-[hsl(32_78%_34%)]">{t(ISSUE_KEY[code] ?? 'ds_issue_generic')}</p>
      ))}
      {estimated ? <p className="text-[13px] text-[#4A5263]">{t('ds_fit_estimate_note')}</p> : null}
    </div>
  );
}

export function ObjectControls({
  object, asset, issues, estimated, palettes, recentColors, locked,
  onRotate, onReplace, onDuplicate, onRemove, onToggleLock, onVariant, onColor,
}: {
  object: ObjectInstance;
  asset: CatalogAsset | undefined;
  issues: PlacementIssue[];
  estimated: boolean;
  palettes: Palette[];
  recentColors: string[];
  locked: boolean;
  onRotate: (deltaRad: number) => void;
  onReplace: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onToggleLock: () => void;
  onVariant: (variant: string | null) => void;
  onColor: (color: string | null) => void;
}) {
  const { t } = useLanguage();
  const disabled = locked || object.locked;
  return (
    <div className="space-y-4">
      {asset ? (
        <p className="text-[14px] text-[#4A5263]" dir="ltr">
          {asset.widthM.toFixed(2)} × {asset.depthM.toFixed(2)} × {asset.heightM.toFixed(2)} m
        </p>
      ) : <p className="text-[14px] text-[hsl(0_66%_40%)]">{t('ds_asset_missing')}</p>}
      {asset?.isPlaceholder ? (
        <p className="rounded-md bg-[#F4F5F7] px-3 py-2 text-[13px] leading-snug text-[#4A5263]">{t('ds_concept_block_note')}</p>
      ) : null}

      <FitFindings issues={issues} estimated={estimated} />

      {object.locked ? <p className="text-[13px] font-medium text-[#0C1119]">{t('ds_object_kept')}</p> : null}

      <div className="grid grid-cols-2 gap-1.5">
        <button type="button" className={ACTION} onClick={onReplace} disabled={disabled}>
          <Replace className="h-4 w-4" aria-hidden="true" />{t('ds_action_replace')}
        </button>
        <button type="button" className={ACTION} onClick={onDuplicate} disabled={locked}>
          <Copy className="h-4 w-4" aria-hidden="true" />{t('ds_action_duplicate')}
        </button>
        <button type="button" className={ACTION} onClick={onToggleLock}>
          {object.locked ? <Unlock className="h-4 w-4" aria-hidden="true" /> : <Lock className="h-4 w-4" aria-hidden="true" />}
          {t(object.locked ? 'ds_action_unkeep' : 'ds_action_keep')}
        </button>
        <button type="button" className={cn(ACTION, 'text-[hsl(0_66%_38%)]')} onClick={onRemove} disabled={disabled}>
          <Trash2 className="h-4 w-4" aria-hidden="true" />{t('ds_action_remove')}
        </button>
      </div>

      <Section title={t('ds_section_rotate')}>
        <div className="grid grid-cols-4 gap-1.5">
          <button type="button" className={ACTION} disabled={disabled} onClick={() => onRotate(Math.PI / 2)} aria-label={t('ds_rotate_left_90')}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />90°
          </button>
          <button type="button" className={ACTION} disabled={disabled} onClick={() => onRotate(Math.PI / 12)} aria-label={t('ds_rotate_left_15')}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />15°
          </button>
          <button type="button" className={ACTION} disabled={disabled} onClick={() => onRotate(-Math.PI / 12)} aria-label={t('ds_rotate_right_15')}>
            15°<RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button type="button" className={ACTION} disabled={disabled} onClick={() => onRotate(-Math.PI / 2)} aria-label={t('ds_rotate_right_90')}>
            90°<RotateCw className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </Section>

      {asset && asset.variants.length > 0 ? (
        <Section title={t('ds_section_finish')}>
          <div className="flex flex-wrap gap-2">
            {asset.variants.map((v) => {
              const c = Object.values(v.colors)[0] ?? '#cccccc';
              return <Swatch key={v.id} color={c} label={v.name} selected={object.materialVariant === v.id} onClick={() => !disabled && onVariant(v.id)} />;
            })}
            {object.materialVariant ? (
              <button type="button" onClick={() => onVariant(null)} disabled={disabled} className="text-[13px] font-medium text-[#4A5263] underline underline-offset-4">
                {t('ds_action_reset')}
              </button>
            ) : null}
          </div>
        </Section>
      ) : null}

      <Section title={t('ds_section_color')}>
        <fieldset disabled={disabled} className="disabled:opacity-50">
          <ColorPicker palettes={palettes.slice(0, 3)} recent={recentColors} current={object.colorOverride} onPick={(c) => onColor(c)} onReset={object.colorOverride ? () => onColor(null) : undefined} />
        </fieldset>
      </Section>
    </div>
  );
}

export type SurfaceScope = 'ONE' | 'ROOM' | 'ALL';

/**
 * Paint and materials for a surface, with the SCOPE of the change stated
 * before it happens: "This wall (1)", "All walls in the living room (4)",
 * "All walls (17)". A mass change is one step and undoes as one.
 */
export function SurfaceControls({
  surfaceId, space, parts = [], state, materials, palettes, recentColors, roomName,
  onMaterial, onColor,
}: {
  surfaceId: string;
  space: SpaceModel | null;
  /** Uploaded models: the identified parts, so `part:<node>` surfaces can be dressed too. */
  parts?: ModelPart[];
  state: DesignState;
  materials: CatalogMaterial[];
  palettes: Palette[];
  recentColors: string[];
  roomName: string;
  onMaterial: (surfaceIds: string[], materialId: string | null) => void;
  onColor: (surfaceIds: string[], color: string | null) => void;
}) {
  const { t } = useLanguage();
  const part = parts.find((p) => p.id === surfaceId) ?? null;
  const parsed = useMemo((): { kind: 'FLOOR' | 'WALL' | 'CEILING'; roomId: string | null } | null => {
    if (part) return part.role === 'FLOOR' || part.role === 'WALL' || part.role === 'CEILING' ? { kind: part.role, roomId: null } : null;
    const p = parseSurfaceId(surfaceId);
    return p && space ? { kind: p.kind, roomId: p.roomId } : null;
  }, [part, space, surfaceId]);
  const [scope, setScope] = useState<SurfaceScope>('ONE');

  const scoped = useMemo(() => {
    if (!parsed) return { ONE: [surfaceId], ROOM: [surfaceId], ALL: [surfaceId] };
    // A model part has no room: this one, or every identified part like it.
    if (part) {
      return { ONE: [surfaceId], ROOM: [surfaceId], ALL: parts.filter((p) => p.role === part.role).map((p) => p.id) };
    }
    const sameKind = (space?.surfaces ?? []).filter((s) => s.kind === parsed.kind);
    return {
      ONE: [surfaceId],
      ROOM: sameKind.filter((s) => s.roomId === parsed.roomId).map((s) => s.id),
      ALL: sameKind.map((s) => s.id),
    };
  }, [parsed, part, parts, space, surfaceId]);
  if (!parsed) return null;

  const kind = parsed.kind;
  const ids = scoped[scope];
  const current = state.surfaces[surfaceId] ?? null;
  const fitting = materials.filter((m) => m.appliesTo.includes(kind));
  const kindWord = t(kind === 'WALL' ? 'ds_scope_walls' : kind === 'FLOOR' ? 'ds_scope_floors' : 'ds_scope_ceilings');

  return (
    <div className="mt-4 space-y-4">
      <div role="radiogroup" aria-label={t('ds_scope_label')} className="space-y-1">
        <p className="mb-1 text-2xs font-semibold uppercase tracking-[0.12em] text-[#4A5263]">{t('ds_scope_label')}</p>
        {([
          ['ONE', t('ds_scope_this', { n: String(scoped.ONE.length) })],
          ...(kind === 'WALL' && !part ? [['ROOM', t('ds_scope_room', { kind: kindWord, room: roomName, n: String(scoped.ROOM.length) })]] : []),
          ['ALL', t('ds_scope_all', { kind: kindWord, n: String(scoped.ALL.length) })],
        ] as Array<[SurfaceScope, string]>).map(([value, label]) => (
          <label key={value} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[14px] text-[#0C1119] hover:bg-[#F4F5F7]">
            <input type="radio" name="ds-scope" value={value} checked={scope === value} onChange={() => setScope(value)} className="accent-[#0C1119]" />
            {label}
          </label>
        ))}
      </div>

      <Section title={t(kind === 'FLOOR' ? 'ds_section_floor_finish' : 'ds_section_material')}>
        <MaterialList
          materials={fitting}
          current={current?.materialId ?? null}
          onPick={(m) => onMaterial(ids, m.id)}
          onReset={current?.materialId ? () => onMaterial(ids, null) : undefined}
        />
      </Section>
      <Section title={t('ds_section_color')}>
        <ColorPicker
          palettes={palettes.slice(0, 4)}
          recent={recentColors}
          current={current?.color ?? null}
          onPick={(c) => onColor(ids, c)}
          onReset={current?.color ? () => onColor(ids, null) : undefined}
        />
      </Section>
    </div>
  );
}

/** An identified piece of furniture inside an uploaded model: it can be hidden, not moved. */
export function PartControls({ hidden, locked, onToggle }: { hidden: boolean; locked: boolean; onToggle: () => void }) {
  const { t } = useLanguage();
  return (
    <div className="space-y-3">
      <p className="text-[14px] leading-relaxed text-[#4A5263]">{t('ds_part_furniture_body')}</p>
      <button
        type="button"
        onClick={onToggle}
        disabled={locked}
        className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-[#D5D9E0] text-[14px] font-medium text-[#0C1119] hover:bg-[#F4F5F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] disabled:opacity-50"
      >
        {hidden ? <Eye className="h-4 w-4" aria-hidden="true" /> : <EyeOff className="h-4 w-4" aria-hidden="true" />}
        {t(hidden ? 'ds_part_show' : 'ds_part_hide')}
      </button>
      {locked ? <p className="text-[13px] text-[#4A5263]">{t('ds_reject_op_category_locked')}</p> : null}
    </div>
  );
}
