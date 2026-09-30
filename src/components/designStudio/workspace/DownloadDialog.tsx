// HOMATCH DESIGN STUDIO — DOWNLOAD THE FINISHED DESIGN.
//
// Only what the renderer can produce faithfully:
//
//   DESIGN IMAGES   2560 × 1440 JPEGs — the overview, the plan from above and
//                   every room from eye level (the Camera Director's shots),
//                   in one ZIP.
//   PRESENTATION    a PDF: a cover, one page per room (render, wall and floor
//                   finishes, furniture) and the plan.
//
// No 3D file is offered: catalogue pieces are HOMATCH concept blocks or
// licensed models whose rights do not include redistribution, and a mesh
// export would not carry the design faithfully. Nothing here is billed.

import React, { useState } from 'react';
import { Camera, FileText, Images, Loader2, X } from 'lucide-react';
import { roomGraph, roomShot, tourOrder } from '@/lib/designStudio/cameraDirector';
import { buildWalkModel } from '@/lib/designStudio/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import type { CatalogAsset, CatalogMaterial } from '@/lib/designStudio/catalog';
import type { DesignState } from '@/lib/designStudio/designState';
import { summarizeDesign } from '@/lib/designStudio/designSummary';
import { fileSlug, pdfFromJpegs, zipStore } from '@/lib/designStudio/exportFiles';
import type { SpaceModel } from '@/lib/designStudio/space';
import type { SceneController } from '../canvas/SceneController';
import { bytesOf, download, renderPages, renderStills, STILL_H, STILL_W } from './exportRender';

export function DownloadDialog({
  controller, space, state, assets, materials, names, projectName, versionName, estimated, onClose,
}: {
  controller: SceneController | null;
  space: SpaceModel;
  state: DesignState;
  assets: Map<string, CatalogAsset>;
  materials: Map<string, CatalogMaterial>;
  names: Map<string, string>;
  projectName: string;
  versionName: string;
  estimated: boolean;
  onClose: () => void;
}) {
  const { t, isRTL } = useLanguage();
  const [busy, setBusy] = useState<'IMAGES' | 'PDF' | 'VIEW' | 'ROOM' | null>(null);
  const rooms = tourOrder(space, roomGraph(space));
  const [photoRoom, setPhotoRoom] = useState<string>(rooms[0] ?? '');
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const base = `homatch-${fileSlug(projectName)}-${fileSlug(versionName, 'version')}`;

  const stills = async () => {
    if (!controller) throw new Error('no canvas');
    return renderStills(controller, space, state, assets, (done, total) => setProgress(t('ds_export_progress', { done: String(done), total: String(total) })));
  };

  const images = async () => {
    setBusy('IMAGES'); setError(false);
    try {
      const shots = await stills();
      const files = await Promise.all(shots.map(async (s, i) => ({
        name: `${String(i + 1).padStart(2, '0')}-${s.roomId ? fileSlug(names.get(s.roomId) ?? '', 'room') : s.key}.jpg`,
        data: await bytesOf(s.blob),
      })));
      download(zipStore(files), `${base}-images.zip`, 'application/zip');
    } catch { setError(true); } finally { setBusy(null); setProgress(null); }
  };

  const presentation = async () => {
    setBusy('PDF'); setError(false);
    try {
      const shots = await stills();
      setProgress(t('ds_export_composing'));
      const summary = summarizeDesign(state, space, assets, materials);
      const pages = await renderPages(shots, summary, {
        brand: 'HOMATCH Design Studio',
        title: projectName,
        subtitle: `${versionName} · ${new Date().toLocaleDateString()}`,
        note: t('ds_preview_note'),
        truth: t(estimated ? 'ds_export_truth_estimated' : 'ds_export_truth_known'),
        palette: t('ds_export_palette'),
        walls: t('ds_export_walls'),
        floor: t('ds_export_floor'),
        furniture: t('ds_export_furniture'),
        none: t('ds_export_none'),
        plan: t('ds_export_plan'),
        pieces: t('ds_export_pieces', { n: String(summary.pieces) }),
        roomName: (id) => names.get(id) ?? '',
        area: (m2) => `${estimated ? '≈ ' : ''}${Math.round(m2 * 10) / 10} m²`,
      }, !!isRTL);
      const jpegs = await Promise.all(pages.map(bytesOf));
      download(pdfFromJpegs(jpegs, [842, 595], `${projectName} - ${versionName}`), `${base}-presentation.pdf`, 'application/pdf');
    } catch { setError(true); } finally { setBusy(null); setProgress(null); }
  };

  /** One photo: the view on screen right now, or a room from the Camera Director's eye-level shot. */
  const photo = async (kind: 'VIEW' | 'ROOM') => {
    if (!controller) return;
    setBusy(kind); setError(false);
    try {
      let blob: Blob | null;
      let label: string;
      if (kind === 'VIEW') {
        blob = await controller.renderStill({ kind: 'CURRENT' }, STILL_W, STILL_H);
        label = 'view';
      } else {
        const pose = roomShot(space, buildWalkModel(space, state.objects, assets), photoRoom, STILL_W / STILL_H);
        blob = pose ? await controller.renderStill({ kind: 'EYE', pose }, STILL_W, STILL_H) : null;
        label = fileSlug(names.get(photoRoom) ?? '', 'room');
      }
      if (!blob) throw new Error('no image');
      download(await bytesOf(blob), `${base}-${label}.jpg`, 'image/jpeg');
    } catch { setError(true); } finally { setBusy(null); }
  };

  const option = 'flex w-full items-start gap-3 rounded-xl border border-[#E4E6EA] p-4 text-start hover:bg-[#F8F9FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(38_92%_56%)] disabled:opacity-60';

  return (
    <div role="dialog" aria-modal="true" aria-label={t('ds_export_title')} className="fixed inset-0 z-50 grid place-items-center bg-[#0C1119]/55 p-3">
      <div className="w-full max-w-md rounded-2xl bg-white text-[#0C1119] shadow-2xl">
        <header className="flex items-start gap-3 border-b border-[#E4E6EA] px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg font-semibold">{t('ds_export_title')}</h2>
            <p className="mt-0.5 text-[13px] text-[#4A5263]">{t('ds_export_intro', { version: versionName })}</p>
          </div>
          <button type="button" onClick={onClose} disabled={!!busy} aria-label={t('ds_action_close')} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-[#F4F5F7]">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>
        <div className="space-y-2.5 px-5 py-4">
          <button type="button" className={option} disabled={!!busy || !controller} onClick={() => { void images(); }}>
            {busy === 'IMAGES' ? <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin" aria-hidden="true" /> : <Images className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(34_90%_31%)]" aria-hidden="true" />}
            <span>
              <span className="block text-[15px] font-semibold">{t('ds_export_images')}</span>
              <span className="mt-0.5 block text-[13px] leading-relaxed text-[#4A5263]">{t('ds_export_images_body')}</span>
            </span>
          </button>
          <button type="button" className={option} disabled={!!busy || !controller} onClick={() => { void presentation(); }}>
            {busy === 'PDF' ? <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin" aria-hidden="true" /> : <FileText className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(34_90%_31%)]" aria-hidden="true" />}
            <span>
              <span className="block text-[15px] font-semibold">{t('ds_export_pdf')}</span>
              <span className="mt-0.5 block text-[13px] leading-relaxed text-[#4A5263]">{t('ds_export_pdf_body')}</span>
            </span>
          </button>
          <div className="rounded-xl border border-[#E4E6EA] p-4">
            <p className="flex items-center gap-2 text-[15px] font-semibold"><Camera className="h-5 w-5 text-[hsl(34_90%_31%)]" aria-hidden="true" />{t('ds_photo_title')}</p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-[#4A5263]">{t('ds_photo_body')}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" disabled={!!busy || !controller} onClick={() => { void photo('VIEW'); }}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#0C1119] px-3 text-[13px] font-semibold text-white disabled:opacity-60">
                {busy === 'VIEW' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}{t('ds_photo_view')}
              </button>
              <select aria-label={t('ds_photo_room_label')} value={photoRoom} onChange={(e) => setPhotoRoom(e.target.value)}
                className="h-9 min-w-0 flex-1 rounded-lg border border-[#D5D9E0] bg-white px-2 text-[13px]">
                {rooms.map((id) => <option key={id} value={id}>{names.get(id)}</option>)}
              </select>
              <button type="button" disabled={!!busy || !controller || !photoRoom} onClick={() => { void photo('ROOM'); }}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#D5D9E0] px-3 text-[13px] font-medium disabled:opacity-60">
                {busy === 'ROOM' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}{t('ds_photo_room')}
              </button>
            </div>
          </div>
          {progress ? <p role="status" className="text-[13px] text-[#4A5263]">{progress}</p> : null}
          {error ? <p role="alert" className="rounded-lg bg-[hsl(0_66%_44%)]/10 px-3 py-2 text-[14px] text-[hsl(0_66%_34%)]">{t('ds_export_error')}</p> : null}
          <p className="text-[13px] leading-relaxed text-[#4A5263]">{t('ds_export_no_3d')}</p>
        </div>
      </div>
    </div>
  );
}
