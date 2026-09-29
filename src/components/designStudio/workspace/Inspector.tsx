import React from 'react';
import { Crosshair, Info } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { parseSurfaceId, type SpaceModel } from '@/lib/designStudio/space';
import { provenanceLabel } from '@/lib/designStudio/spatialSource';
import type { SpatialSourceRecord } from '@/lib/designStudio/types';
import type { ModelAnalysisSummary, ModelPart } from '@/lib/designStudio/modelParts';
import type { PickTarget } from '../canvas/SceneController';
import { formatArea, formatLength } from './labels';

export interface InspectorProps {
  source: SpatialSourceRecord;
  space: SpaceModel | null;
  names: Map<string, string>;
  selection: PickTarget | null;
  onSelect: (target: PickTarget) => void;
  onFocusRoom: (roomId: string) => void;
  /** Floor-plan spaces: change the measurements. */
  onRecalibrate?: () => void;
  /** Uploaded models: the server's analysis and the parts it identified. */
  model?: ModelAnalysisSummary | null;
  parts?: ModelPart[];
  /** Heading for a selected object (asset name, room). */
  objectHeading?: { eyebrow: string; title: string };
  /** Controls for the selected thing, contributed by the editing layer. */
  children?: React.ReactNode;
}

function Heading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="border-b border-[#E4E6EA] px-4 pb-3 pt-4">
      <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-[hsl(34_90%_31%)]">{eyebrow}</p>
      <h2 className="mt-0.5 break-words font-display text-[17px] font-semibold leading-snug text-[#0C1119]">{title}</h2>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-[14px]">
      <dt className="text-[#4A5263]">{label}</dt>
      <dd className="text-end font-medium text-[#0C1119]">{value}</dd>
    </div>
  );
}

/**
 * THE INSPECTOR ANSWERS ONE QUESTION FIRST: WHAT AM I EDITING?
 *
 * Nothing selected → the space itself and how far its dimensions can be
 * trusted. A room → that room. A surface → which surface, in which room.
 * An object → that object. Only controls that apply to the selection appear.
 */
const PART_ROLE_KEY: Record<ModelPart['role'], string> = {
  FLOOR: 'ds_surface_floor', WALL: 'ds_surface_wall', CEILING: 'ds_surface_ceiling',
  DOOR: 'ds_part_door', WINDOW: 'ds_part_window', FURNITURE: 'ds_part_furniture',
};

const EDITABILITY_BODY: Record<ModelAnalysisSummary['editability'], string> = {
  FULLY_STRUCTURED: 'ds_mi_class_full_body',
  PARTIALLY_STRUCTURED: 'ds_mi_class_partial_body',
  VISUAL_MODEL: 'ds_editability_visual_body',
};

const approxM = (n: number) => `≈ ${(Math.round(n * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 })} m`;

export function Inspector({ source, space, names, selection, onSelect, onFocusRoom, onRecalibrate, model, parts = [], objectHeading, children }: InspectorProps) {
  const { t } = useLanguage();
  const label = provenanceLabel(source);
  const state = source.geometry_state;

  if (!selection) {
    const indoor = space?.rooms.filter((r) => !r.outdoor) ?? [];
    const area = indoor.reduce((sum, r) => sum + r.areaM2, 0);
    const prov = source.provenance as Record<string, unknown>;
    const typicalCeiling = (source.canonical as { ceilingSource?: string } | null)?.ceilingSource === 'TYPICAL';
    const devContext = source.kind === 'DEVELOPER_UNIT'
      ? [prov.project_name, prov.building_name, prov.floor_level != null ? t('ds_floor_n', { n: String(prov.floor_level) }) : null,
        prov.unit_number ? t('ds_unit_n', { n: String(prov.unit_number) }) : null].filter(Boolean).join(' · ')
      : null;
    return (
      <div>
        <Heading eyebrow={t('ds_inspector_space')} title={t(label.originKey)} />
        <div className="px-4 py-3">
          {devContext ? <p className="mb-2 text-[14px] text-[#4A5263]">{devContext}</p> : null}
          <dl className="divide-y divide-[#EEF0F3]">
            <Row label={t('ds_inspector_dimensions')} value={t(label.geometryKey)} />
            {space ? <Row label={t('ds_inspector_rooms')} value={String(space.rooms.length)} /> : null}
            {space && area > 0 ? <Row label={t('ds_inspector_indoor_area')} value={formatArea(area, state, t)} /> : null}
            {space ? (
              <Row
                label={t('ds_inspector_ceiling')}
                value={typicalCeiling
                  ? `${formatLength(space.ceilingHeightM, 'ESTIMATED', t)} · ${t('ds_inspector_ceiling_typical')}`
                  : formatLength(space.ceilingHeightM, state, t)}
              />
            ) : null}
            {label.editabilityKey ? <Row label={t('ds_inspector_editability')} value={t(label.editabilityKey)} /> : null}
            {model ? (
              <Row
                label={t('ds_inspector_size')}
                value={`${approxM(model.normalization.sizeM[0])} × ${approxM(model.normalization.sizeM[2])}`}
              />
            ) : null}
            {model ? <Row label={t('ds_inspector_height')} value={approxM(model.normalization.sizeM[1])} /> : null}
          </dl>
          {model ? <p className="mt-3 text-[13px] leading-relaxed text-[#4A5263]">{t(EDITABILITY_BODY[model.editability])}</p> : null}
          <p className="mt-3 flex gap-2 rounded-md bg-[#F4F5F7] px-3 py-2.5 text-[13px] leading-relaxed text-[#4A5263]">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {t(state === 'ESTIMATED' ? 'ds_truth_estimated' : 'ds_truth_known')}
          </p>
          {onRecalibrate ? (
            <button
              type="button"
              onClick={onRecalibrate}
              className="mt-3 inline-flex h-9 w-full items-center justify-center rounded-lg border border-[#D5D9E0] text-[14px] font-medium text-[#0C1119] hover:bg-[#F4F5F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]"
            >
              {t(state === 'VERIFIED' ? 'ds_fp_change_measurements' : 'ds_fp_calibrate')}
            </button>
          ) : null}
          {!space && !model ? <p className="mt-3 text-[13px] text-[#4A5263]">{t('ds_rooms_unavailable_model')}</p> : null}
          <p className="mt-4 text-[14px] text-[#4A5263]">{t('ds_inspector_hint')}</p>
        </div>
      </div>
    );
  }

  if (selection.kind === 'room' && space) {
    const room = space.rooms.find((r) => r.id === selection.id);
    if (!room) return null;
    const surfaces = space.surfaces.filter((s) => s.roomId === room.id);
    const walls = surfaces.filter((s) => s.kind === 'WALL');
    return (
      <div>
        <Heading eyebrow={t('ds_inspector_room')} title={names.get(room.id) ?? ''} />
        <div className="px-4 py-3">
          <dl className="divide-y divide-[#EEF0F3]">
            <Row label={t('ds_inspector_area')} value={formatArea(room.areaM2, state, t)} />
            <Row
              label={t('ds_inspector_size')}
              value={`${formatLength(room.bounds.maxX - room.bounds.minX, state, t)} × ${formatLength(room.bounds.maxY - room.bounds.minY, state, t)}`}
            />
          </dl>
          <button
            type="button"
            onClick={() => onFocusRoom(room.id)}
            className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-[#D5D9E0] text-[14px] font-medium text-[#0C1119] hover:bg-[#F4F5F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]"
          >
            <Crosshair className="h-4 w-4" aria-hidden="true" />
            {t('ds_action_focus_room')}
          </button>
          <p className="mt-5 text-2xs font-semibold uppercase tracking-[0.12em] text-[#4A5263]">{t('ds_inspector_surfaces')}</p>
          <ul className="mt-1.5 space-y-1">
            {surfaces.filter((s) => s.kind !== 'WALL').map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onSelect({ kind: 'surface', id: s.id, roomId: room.id })}
                  className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-start text-[14px] text-[#0C1119] hover:bg-[#F4F5F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]"
                >
                  {t(s.kind === 'FLOOR' ? 'ds_surface_floor' : 'ds_surface_ceiling')}
                </button>
              </li>
            ))}
            {walls.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onSelect({ kind: 'surface', id: s.id, roomId: room.id })}
                  className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-start text-[14px] text-[#0C1119] hover:bg-[#F4F5F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]"
                >
                  {t('ds_surface_wall_n', { n: String(i + 1) })}
                </button>
              </li>
            ))}
          </ul>
          {children}
        </div>
      </div>
    );
  }

  if (selection.kind === 'surface' || selection.kind === 'part') {
    const part = parts.find((p) => p.id === selection.id);
    if (part) {
      return (
        <div>
          <Heading eyebrow={t('ds_part_of_model')} title={t(PART_ROLE_KEY[part.role])} />
          <div className="px-4 py-3">{children}</div>
        </div>
      );
    }
  }

  if (selection.kind === 'surface') {
    const parsed = parseSurfaceId(selection.id);
    if (!parsed) return null;
    const title = t(parsed.kind === 'FLOOR' ? 'ds_surface_floor' : parsed.kind === 'CEILING' ? 'ds_surface_ceiling' : 'ds_surface_wall');
    const roomName = names.get(parsed.roomId) ?? '';
    return (
      <div>
        <Heading eyebrow={roomName} title={title} />
        <div className="px-4 py-3">
          <button
            type="button"
            onClick={() => onSelect({ kind: 'room', id: parsed.roomId })}
            className="text-[14px] font-medium text-[#0C1119] underline underline-offset-4 hover:text-[hsl(34_90%_31%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)]"
          >
            {t('ds_action_select_room', { room: roomName })}
          </button>
          {children}
        </div>
      </div>
    );
  }

  if (selection.kind === 'model') {
    return (
      <div>
        <Heading eyebrow={t('ds_inspector_space')} title={t('ds_inspector_model')} />
        <div className="px-4 py-3 text-[14px] leading-relaxed text-[#4A5263]">
          {t(model ? EDITABILITY_BODY[model.editability] : source.editability === 'VISUAL_MODEL' ? 'ds_editability_visual_body' : 'ds_editability_unclassified_body')}
        </div>
      </div>
    );
  }

  if (selection.kind === 'object') {
    return (
      <div>
        {objectHeading ? <Heading eyebrow={objectHeading.eyebrow} title={objectHeading.title} /> : null}
        <div className="px-4 py-3">{children}</div>
      </div>
    );
  }

  return <div>{children}</div>;
}
